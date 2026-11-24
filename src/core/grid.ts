// 三维规则网格：构建、粮堆掩码、测点插值（坏点 NaN 跳过）、分块元数据
import type { SensorPoint, Warehouse } from '../types'
import { idw3d } from './math_utils'
import { Bounds, insideGrain, surfaceHeight, warehouseBounds } from './geometry'

export const OUTSIDE = -999 // 粮堆外哨兵值，绝不能与真实粮温混淆

export interface GridSpec {
  nx: number
  ny: number
  nz: number
  bounds: Bounds
  dx: number
  dy: number
  dz: number
  cellVolume: number
}

export interface GridField {
  spec: GridSpec
  values: Float32Array // 节点标量（温度），粮堆外 = OUTSIDE
  mask: Uint8Array // 节点是否在粮堆内
  chunkSize: number
  chunkCount: number
  chunkMin: Float32Array
  chunkMax: Float32Array
  insideNodes: number
}

export const buildGridSpec = (w: Warehouse, resolution: number): GridSpec => {
  const b = warehouseBounds(w)
  const nx = resolution
  const ny = Math.max(8, Math.round((resolution * (b.maxY - b.minY)) / (b.maxX - b.minX)))
  const nz = Math.max(8, Math.round((resolution * (b.maxZ - b.minZ)) / (b.maxX - b.minX)))
  const dx = (b.maxX - b.minX) / (nx - 1)
  const dy = (b.maxY - b.minY) / (ny - 1)
  const dz = (b.maxZ - b.minZ) / (nz - 1)
  return { nx, ny, nz, bounds: b, dx, dy, dz, cellVolume: dx * dy * dz }
}

export const nodeIndex = (spec: GridSpec, i: number, j: number, k: number): number =>
  i + spec.nx * (j + spec.ny * k)

export const nodePos = (spec: GridSpec, i: number, j: number, k: number) => {
  const b = spec.bounds
  return {
    x: b.minX + i * spec.dx,
    y: b.minY + j * spec.dy,
    z: b.minZ + k * spec.dz,
  }
}

// 空间哈希：按电缆 xy 分桶，插值时只扫近邻；读数直接绑在桶元素上
interface HashSample {
  x: number
  y: number
  z: number
  value: number
}

class SpatialHash {
  private cell: number
  private map = new Map<number, HashSample[]>()

  constructor(samples: HashSample[], cellSize: number) {
    this.cell = cellSize
    for (const p of samples) {
      const key = this.key(Math.floor(p.x / cellSize), Math.floor(p.y / cellSize))
      const arr = this.map.get(key)
      if (arr) arr.push(p)
      else this.map.set(key, [p])
    }
  }

  private key(cx: number, cy: number): number {
    return cx * 73856093 ^ cy * 19349663
  }

  nearby(x: number, y: number, radiusCells: number): HashSample[] {
    const cx = Math.floor(x / this.cell)
    const cy = Math.floor(y / this.cell)
    const out: HashSample[] = []
    for (let dx = -radiusCells; dx <= radiusCells; dx++) {
      for (let dy = -radiusCells; dy <= radiusCells; dy++) {
        const arr = this.map.get(this.key(cx + dx, cy + dy))
        if (arr) out.push(...arr)
      }
    }
    return out
  }
}

export interface InterpolateInput {
  warehouse: Warehouse
  sensors: SensorPoint[]
  readings: Float32Array
  spec: GridSpec
  chunkSize?: number
  // 失效点状态（坏点 + 断线），与 sensors 同序
  invalid: Uint8Array
}

// 测点插值到规则网格。坏点/断线 NaN 直接剔除，绝不参与插值，更不会当 0 度
export const interpolateField = (input: InterpolateInput): GridField => {
  const { warehouse: w, sensors, readings, spec } = input
  const chunkSize = input.chunkSize ?? 8
  const total = spec.nx * spec.ny * spec.nz
  const values = new Float32Array(total).fill(OUTSIDE)
  const mask = new Uint8Array(total)

  const validSamples: HashSample[] = []
  for (let i = 0; i < sensors.length; i++) {
    if (input.invalid[i]) continue
    const v = readings[i]
    if (!Number.isFinite(v)) continue
    const s = sensors[i]
    validSamples.push({ x: s.x, y: s.y, z: s.z, value: v })
  }
  const hash = new SpatialHash(validSamples, 6)
  const samples: HashSample[] = []

  for (let k = 0; k < spec.nz; k++) {
    for (let j = 0; j < spec.ny; j++) {
      for (let i = 0; i < spec.nx; i++) {
        const idx = nodeIndex(spec, i, j, k)
        const pos = nodePos(spec, i, j, k)
        if (!insideGrain(w, pos.x, pos.y, pos.z)) continue
        mask[idx] = 1
        samples.length = 0
        samples.push(...hash.nearby(pos.x, pos.y, 1))
        // 近邻不足时扩一圈，再不足用全部有效点兜底
        if (samples.length < 4) {
          const wider = hash.nearby(pos.x, pos.y, 2)
          for (const s of wider) {
            if (!samples.some((q) => q.x === s.x && q.y === s.y && q.z === s.z)) samples.push(s)
          }
        }
        if (samples.length === 0) samples.push(...validSamples)
        values[idx] = idw3d(pos.x, pos.y, pos.z, samples)
      }
    }
  }

  const chunkCountX = Math.ceil(spec.nx / chunkSize)
  const chunkCountY = Math.ceil(spec.ny / chunkSize)
  const chunkCountZ = Math.ceil(spec.nz / chunkSize)
  const chunkCount = chunkCountX * chunkCountY * chunkCountZ
  const chunkMin = new Float32Array(chunkCount).fill(Infinity)
  const chunkMax = new Float32Array(chunkCount).fill(-Infinity)
  let insideNodes = 0

  for (let k = 0; k < spec.nz; k++) {
    for (let j = 0; j < spec.ny; j++) {
      for (let i = 0; i < spec.nx; i++) {
        const idx = nodeIndex(spec, i, j, k)
        if (!mask[idx]) continue
        insideNodes++
        const ci = Math.floor(i / chunkSize)
        const cj = Math.floor(j / chunkSize)
        const ck = Math.floor(k / chunkSize)
        const cIdx = ci + chunkCountX * (cj + chunkCountY * ck)
        const v = values[idx]
        if (v < chunkMin[cIdx]) chunkMin[cIdx] = v
        if (v > chunkMax[cIdx]) chunkMax[cIdx] = v
      }
    }
  }

  return { spec, values, mask, chunkSize, chunkCount, chunkMin, chunkMax, insideNodes }
}

// 封闭化：让等值面在粮堆边界（粮面/仓壁）自然收口，产出水密闭合网格。
// 做法：粮堆外节点与网格 domain 边界节点统一赋足够冷的值，mask 全置 1，
// 使热区被冷值完全包围，Marching Cubes 沿冷-热过渡生成完整闭合壳，无需事后盖面。
export const sealFieldForIsosurface = (field: GridField, threshold: number): GridField => {
  const { spec } = field
  const { nx, ny, nz } = spec
  const cold = threshold - 100
  const values = new Float32Array(field.values)
  const mask = new Uint8Array(field.values.length).fill(1)
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const idx = nodeIndex(spec, i, j, k)
        const onDomainEdge = i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1
        if (!field.mask[idx] || onDomainEdge) {
          values[idx] = cold
        }
      }
    }
  }
  // 重新统计分块极值
  const chunkSize = field.chunkSize
  const ccx = Math.ceil(nx / chunkSize)
  const ccy = Math.ceil(ny / chunkSize)
  const ccz = Math.ceil(nz / chunkSize)
  const chunkCount = ccx * ccy * ccz
  const chunkMin = new Float32Array(chunkCount).fill(Infinity)
  const chunkMax = new Float32Array(chunkCount).fill(-Infinity)
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const idx = nodeIndex(spec, i, j, k)
        const cIdx = Math.floor(i / chunkSize) + ccx * (Math.floor(j / chunkSize) + ccy * Math.floor(k / chunkSize))
        if (values[idx] < chunkMin[cIdx]) chunkMin[cIdx] = values[idx]
        if (values[idx] > chunkMax[cIdx]) chunkMax[cIdx] = values[idx]
      }
    }
  }
  return { spec, values, mask, chunkSize, chunkCount, chunkMin, chunkMax, insideNodes: values.length }
}

// 数格子参考体积：格心三线性采样超阈值即计入（验收基准）
export const countGridVolume = (field: GridField, threshold: number): number => {
  const { spec, values, mask } = field
  let count = 0
  for (let k = 0; k < spec.nz - 1; k++) {
    for (let j = 0; j < spec.ny - 1; j++) {
      for (let i = 0; i < spec.nx - 1; i++) {
        const idx = nodeIndex(spec, i, j, k)
        const nx = spec.nx
        const nxy = spec.nx * spec.ny
        const corners = [
          idx,
          idx + 1,
          idx + nx,
          idx + nx + 1,
          idx + nxy,
          idx + nxy + 1,
          idx + nx + nxy,
          idx + nx + nxy + 1,
        ]
        // 贴粮堆边界的残缺格不计入，与 MC 跳过 valid<8 保持一致
        let valid = 0
        for (const q of corners) if (mask[q]) valid++
        if (valid < 8) continue
        // 格心三线性平均
        const c000 = values[corners[0]]
        const c100 = values[corners[1]]
        const c010 = values[corners[2]]
        const c110 = values[corners[3]]
        const c001 = values[corners[4]]
        const c101 = values[corners[5]]
        const c011 = values[corners[6]]
        const c111 = values[corners[7]]
        const mean =
          (c000 + c100 + c010 + c110 + c001 + c101 + c011 + c111) / 8
        if (mean >= threshold) count++
      }
    }
  }
  return count * spec.cellVolume
}

// 粮面三角网格（渲染叠加用，规则栅格 + 对角线）
export const buildSurfaceMesh = (w: Warehouse, spec: GridSpec) => {
  const positions: number[] = []
  const indices: number[] = []
  const grid: number[][] = []
  for (let j = 0; j < spec.ny; j++) {
    grid[j] = []
    for (let i = 0; i < spec.nx; i++) {
      const p = nodePos(spec, i, j, 0)
      grid[j][i] = positions.length / 3
      positions.push(p.x, p.y, surfaceHeight(w, p.x, p.y))
    }
  }
  for (let j = 0; j < spec.ny - 1; j++) {
    for (let i = 0; i < spec.nx - 1; i++) {
      const a = grid[j][i]
      const b = grid[j][i + 1]
      const c = grid[j + 1][i]
      const d = grid[j + 1][i + 1]
      indices.push(a, c, b, b, c, d)
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) }
}
