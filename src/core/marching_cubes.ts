// Marching Cubes 抽取主流程（确定性查表版）
// 逐格：8 角点定 case -> 查 TRI_TABLE 得三角形（边号）-> 边交点全局缓存去重
// 相邻格共享同一条格边的交点顶点，共享面上两侧三角形几何重合 => 水密流形
// 二义面由 facePairings 的 Nielson 渐近线判定吸收进离线表，运行时无分支歧义
import { EDGE_CORNERS, McMesh } from './mc_tables'
import { TRI_TABLE, TRIANGLES_PER_CASE } from './tri_table'
import { GridField, nodeIndex, nodePos } from './grid'
import { norm } from './math_utils'

interface ExtractionOptions {
  threshold: number
  activeChunks?: Uint8Array
  labelBlobs?: boolean
}

export interface BlobInfo {
  cellCount: number
  volume: number
  gridVolume: number
  maxTemp: number
  cx: number
  cy: number
  cz: number
  cells: number[]
}

export interface ExtractionResult {
  mesh: McMesh
  blobs: BlobInfo[]
  touchedCells: number
  ms: number
  vertexEdgeKey: Int32Array
  // 物理格边 key（loNode*totalNodes+hiNode）-> 交点顶点 id，供边界盖面复用
  edgeKeyToVertex: Map<number, number>
}

const cellCode = (i: number, j: number, k: number, nx: number, ny: number): number =>
  i + nx * (j + ny * k)

const cellCornerNodes = (field: GridField, i: number, j: number, k: number): number[] => {
  const { spec } = field
  const base = nodeIndex(spec, i, j, k)
  const nx = spec.nx
  const nxy = spec.nx * spec.ny
  // 严格对应 CORNER_OFFSETS：
  // 0(0,0,0) 1(1,0,0) 2(1,1,0) 3(0,1,0)
  // 4(0,0,1) 5(1,0,1) 6(1,1,1) 7(0,1,1)
  return [
    base, // 0
    base + 1, // 1
    base + nx + 1, // 2
    base + nx, // 3
    base + nxy, // 4
    base + nxy + 1, // 5
    base + nx + nxy + 1, // 6
    base + nx + nxy, // 7
  ]
}

const gradientAt = (field: GridField, node: number, i: number, j: number, k: number) => {
  const { spec, values, mask } = field
  const xl = i > 0 && mask[node - 1] ? values[node - 1] : values[node]
  const xr = i < spec.nx - 1 && mask[node + 1] ? values[node + 1] : values[node]
  const yl = j > 0 && mask[node - spec.nx] ? values[node - spec.nx] : values[node]
  const yr = j < spec.ny - 1 && mask[node + spec.nx] ? values[node + spec.nx] : values[node]
  const nxy = spec.nx * spec.ny
  const zl = k > 0 && mask[node - nxy] ? values[node - nxy] : values[node]
  const zr = k < spec.nz - 1 && mask[node + nxy] ? values[node + nxy] : values[node]
  return norm({ x: (xr - xl) / (2 * spec.dx), y: (yr - yl) / (2 * spec.dy), z: (zr - zl) / (2 * spec.dz) })
}

const nodePosFromNode = (spec: GridField['spec'], node: number) => {
  const nxy = spec.nx * spec.ny
  const i = node % spec.nx
  const j = ((node - i) / spec.nx) % spec.ny
  const k = (node - i - j * spec.nx) / nxy
  return nodePos(spec, i, j, k)
}

// 世界坐标处三线性梯度（指向高温内部），用于三角形朝外定向
const sampleGradient = (field: GridField, x: number, y: number, z: number) => {
  const { spec, values, mask } = field
  const b = spec.bounds
  const fi = (x - b.minX) / spec.dx
  const fj = (y - b.minY) / spec.dy
  const fk = (z - b.minZ) / spec.dz
  const i0 = Math.max(0, Math.min(spec.nx - 2, Math.floor(fi)))
  const j0 = Math.max(0, Math.min(spec.ny - 2, Math.floor(fj)))
  const k0 = Math.max(0, Math.min(spec.nz - 2, Math.floor(fk)))
  const tx = Math.max(0, Math.min(1, fi - i0))
  const ty = Math.max(0, Math.min(1, fj - j0))
  const tz = Math.max(0, Math.min(1, fk - k0))
  const at = (i: number, j: number, k: number): number => {
    const nd = nodeIndex(spec, i, j, k)
    return mask[nd] ? values[nd] : values[findNearestValid(field, i, j, k)]
  }
  const c000 = at(i0, j0, k0)
  const c100 = at(i0 + 1, j0, k0)
  const c010 = at(i0, j0 + 1, k0)
  const c110 = at(i0 + 1, j0 + 1, k0)
  const c001 = at(i0, j0, k0 + 1)
  const c101 = at(i0 + 1, j0, k0 + 1)
  const c011 = at(i0, j0 + 1, k0 + 1)
  const c111 = at(i0 + 1, j0 + 1, k0 + 1)
  const dVdx =
    ((1 - ty) * (1 - tz) * (c100 - c000) + ty * (1 - tz) * (c110 - c010) +
      (1 - ty) * tz * (c101 - c001) + ty * tz * (c111 - c011)) / spec.dx
  const dVdy =
    ((1 - tx) * (1 - tz) * (c010 - c000) + tx * (1 - tz) * (c110 - c100) +
      (1 - tx) * tz * (c011 - c001) + tx * tz * (c111 - c101)) / spec.dy
  const dVdz =
    ((1 - tx) * (1 - ty) * (c001 - c000) + tx * (1 - ty) * (c101 - c100) +
      (1 - tx) * ty * (c011 - c010) + tx * ty * (c111 - c110)) / spec.dz
  return norm({ x: dVdx, y: dVdy, z: dVdz })
}

const findNearestValid = (field: GridField, i: number, j: number, k: number): number => {
  const { spec, mask } = field
  for (let r = 1; r < Math.max(spec.nx, spec.ny, spec.nz); r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue
          const ni = i + dx
          const nj = j + dy
          const nk = k + dz
          if (ni < 0 || nj < 0 || nk < 0 || ni >= spec.nx || nj >= spec.ny || nk >= spec.nz) continue
          const nd = nodeIndex(spec, ni, nj, nk)
          if (mask[nd]) return nd
        }
      }
    }
  }
  return 0
}

const labelConnectedCells = (
  field: GridField,
  threshold: number,
  active: Uint8Array,
): BlobInfo[] => {
  const { spec, values, mask } = field
  const cellNx = spec.nx - 1
  const cellNy = spec.ny - 1
  const cellNz = spec.nz - 1
  const visited = new Uint8Array(cellNx * cellNy * cellNz)
  const blobs: BlobInfo[] = []
  const stack: number[] = []

  const cellHot = (i: number, j: number, k: number): boolean => {
    const corners = cellCornerNodes(field, i, j, k)
    let sum = 0
    for (const q of corners) {
      if (!mask[q]) return false
      sum += values[q]
    }
    // 与数格法一致：格心均值（角点平均）超阈值即热格
    return sum / 8 >= threshold
  }

  for (let k = 0; k < cellNz; k++) {
    for (let j = 0; j < cellNy; j++) {
      for (let i = 0; i < cellNx; i++) {
        const code = cellCode(i, j, k, cellNx, cellNy)
        if (visited[code] || !active[code]) continue
        visited[code] = 1
        if (!cellHot(i, j, k)) continue
        const cells: number[] = []
        let maxTemp = -Infinity
        let sx = 0
        let sy = 0
        let sz = 0
        stack.length = 0
        stack.push(code)
        while (stack.length > 0) {
          const cur = stack.pop() as number
          const ci = cur % cellNx
          const cj = ((cur / cellNx) | 0) % cellNy
          const ck = (cur / (cellNx * cellNy)) | 0
          cells.push(cur)
          const center = nodePos(spec, ci + 0.5, cj + 0.5, ck + 0.5)
          sx += center.x
          sy += center.y
          sz += center.z
          const corners = cellCornerNodes(field, ci, cj, ck)
          for (const q of corners) {
            if (mask[q] && values[q] > maxTemp) maxTemp = values[q]
          }
          const neighbors: Array<[number, number, number]> = [
            [ci + 1, cj, ck], [ci - 1, cj, ck],
            [ci, cj + 1, ck], [ci, cj - 1, ck],
            [ci, cj, ck + 1], [ci, cj, ck - 1],
          ]
          for (const [ni, nj, nk] of neighbors) {
            if (ni < 0 || nj < 0 || nk < 0 || ni >= cellNx || nj >= cellNy || nk >= cellNz) continue
            const nc = cellCode(ni, nj, nk, cellNx, cellNy)
            if (visited[nc] || !active[nc]) continue
            visited[nc] = 1
            if (cellHot(ni, nj, nk)) stack.push(nc)
          }
        }
        const n = cells.length
        blobs.push({
          cellCount: n,
          volume: 0,
          gridVolume: n * spec.cellVolume,
          maxTemp,
          cx: sx / n,
          cy: sy / n,
          cz: sz / n,
          cells,
        })
      }
    }
  }
  return blobs
}

export const extractIsosurface = (
  field: GridField,
  options: ExtractionOptions,
): ExtractionResult => {
  const t0 = performance.now()
  const { spec, values, mask, chunkSize, chunkMin, chunkMax } = field
  const { threshold } = options
  const cellNx = spec.nx - 1
  const cellNy = spec.ny - 1
  const cellNz = spec.nz - 1
  const chunksX = Math.ceil(spec.nx / chunkSize)
  const chunksY = Math.ceil(spec.ny / chunkSize)
  const totalNodes = spec.nx * spec.ny * spec.nz

  const edgeVertex = new Map<number, number>()
  const vertexEdgeKey: number[] = []
  const gradCache = new Float32Array(totalNodes * 3).fill(NaN)
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []

  const gradientAtNode = (node: number) => {
    const o = node * 3
    if (!Number.isNaN(gradCache[o])) return { x: gradCache[o], y: gradCache[o + 1], z: gradCache[o + 2] }
    const nxy = spec.nx * spec.ny
    const i = node % spec.nx
    const j = ((node - i) / spec.nx) % spec.ny
    const k = (node - i - j * spec.nx) / nxy
    const g = gradientAt(field, node, i, j, k)
    gradCache[o] = g.x
    gradCache[o + 1] = g.y
    gradCache[o + 2] = g.z
    return g
  }

  const getEdgeVertex = (edgeKey: number, na: number, nb: number): number => {
    const cached = edgeVertex.get(edgeKey)
    if (cached !== undefined) return cached
    const va = values[na]
    const vb = values[nb]
    const t = (threshold - va) / (vb - va)
    const pa = nodePosFromNode(spec, na)
    const pb = nodePosFromNode(spec, nb)
    const idx = positions.length / 3
    positions.push(
      pa.x + (pb.x - pa.x) * t,
      pa.y + (pb.y - pa.y) * t,
      pa.z + (pb.z - pa.z) * t,
    )
    const ga = gradientAtNode(na)
    const gb = gradientAtNode(nb)
    normals.push(
      ga.x + (gb.x - ga.x) * t,
      ga.y + (gb.y - ga.y) * t,
      ga.z + (gb.z - ga.z) * t,
    )
    edgeVertex.set(edgeKey, idx)
    vertexEdgeKey.push(edgeKey)
    return idx
  }

  const active = new Uint8Array(cellNx * cellNy * cellNz)
  let touchedCells = 0
  // 每个格 12 边的交点顶点缓存（本格内）
  const cellEdgeVerts = new Int32Array(12).fill(-1)

  for (let k = 0; k < cellNz; k++) {
    for (let j = 0; j < cellNy; j++) {
      for (let i = 0; i < cellNx; i++) {
        const code = cellCode(i, j, k, cellNx, cellNy)
        if (options.activeChunks && !options.activeChunks[code]) continue
        const corners = cellCornerNodes(field, i, j, k)
        let valid = 0
        for (const q of corners) if (mask[q]) valid++
        if (valid < 8) continue
        const ci = Math.floor(i / chunkSize)
        const cj = Math.floor(j / chunkSize)
        const ck = Math.floor(k / chunkSize)
        // 格的 8 角点跨越最多 8 个 chunk（角点 i+1/j+1/k+1 可能进入下一 chunk），
        // 必须检查这些 chunk 极值的并集，单点 chunk 的 min/max 不足以判定
        const ci1 = Math.floor((i + 1) / chunkSize)
        const cj1 = Math.floor((j + 1) / chunkSize)
        const ck1 = Math.floor((k + 1) / chunkSize)
        let localMin = Infinity
        let localMax = -Infinity
        for (let x = ci; x <= ci1; x++) {
          for (let y = cj; y <= cj1; y++) {
            for (let z = ck; z <= ck1; z++) {
              const cIdx = x + chunksX * (y + chunksY * z)
              if (chunkMin[cIdx] < localMin) localMin = chunkMin[cIdx]
              if (chunkMax[cIdx] > localMax) localMax = chunkMax[cIdx]
            }
          }
        }
        if (threshold < localMin || threshold > localMax) continue
        active[code] = 1
        touchedCells++

        let caseIndex = 0
        for (let c = 0; c < 8; c++) {
          if (values[corners[c]] >= threshold) caseIndex |= 1 << c
        }
        if (caseIndex === 0 || caseIndex === 255) continue

        cellEdgeVerts.fill(-1)
        const base = caseIndex * TRIANGLES_PER_CASE
        for (let t = 0; t < TRIANGLES_PER_CASE; t += 3) {
          const e0 = TRI_TABLE[base + t]
          if (e0 < 0) break
          const e1 = TRI_TABLE[base + t + 1]
          const e2 = TRI_TABLE[base + t + 2]
          const triEdges = [e0, e1, e2]
          const triVerts = triEdges.map((e) => {
            let vi = cellEdgeVerts[e]
            if (vi >= 0) return vi
            const [u, v] = EDGE_CORNERS[e]
            const na = corners[u]
            const nb = corners[v]
            const lo = na < nb ? na : nb
            const hi = na < nb ? nb : na
            vi = getEdgeVertex(lo * totalNodes + hi, lo, hi)
            cellEdgeVerts[e] = vi
            return vi
          })
          // 定向：用三角形三顶点的边交点法线（梯度，指向高温内部）平均，
          // 朝外法向取 -g。顶点法线已做两端梯度混合，比质心采样稳定。
          const [ta, tb, tc] = triVerts
          const gx = normals[ta * 3] + normals[tb * 3] + normals[tc * 3]
          const gy = normals[ta * 3 + 1] + normals[tb * 3 + 1] + normals[tc * 3 + 1]
          const gz = normals[ta * 3 + 2] + normals[tb * 3 + 2] + normals[tc * 3 + 2]
          const ax = positions[tb * 3] - positions[ta * 3]
          const ay = positions[tb * 3 + 1] - positions[ta * 3 + 1]
          const az = positions[tb * 3 + 2] - positions[ta * 3 + 2]
          const bx = positions[tc * 3] - positions[ta * 3]
          const by = positions[tc * 3 + 1] - positions[ta * 3 + 1]
          const bz = positions[tc * 3 + 2] - positions[ta * 3 + 2]
          const crossX = ay * bz - az * by
          const crossY = az * bx - ax * bz
          const crossZ = ax * by - ay * bx
          if (crossX * -gx + crossY * -gy + crossZ * -gz >= 0) {
            indices.push(ta, tb, tc)
          } else {
            indices.push(ta, tc, tb)
          }
        }
      }
    }
  }

  const mesh: McMesh = {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
  }

  let blobs: BlobInfo[] = []
  if (options.labelBlobs) {
    blobs = labelConnectedCells(field, threshold, active)
    const meshVolume = meshVolumeSigned(mesh)
    const sum = blobs.reduce((s, b) => s + b.cellCount, 0)
    blobs.forEach((b) => {
      b.volume = sum === 0 ? 0 : (meshVolume * b.cellCount) / sum
    })
  }

  return {
    mesh,
    blobs,
    touchedCells,
    ms: performance.now() - t0,
    vertexEdgeKey: Int32Array.from(vertexEdgeKey),
    edgeKeyToVertex: new Map(edgeVertex),
  }
}

export const meshVolumeSigned = (mesh: McMesh): number => {
  const { positions, indices } = mesh
  let vol = 0
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3
    const b = indices[t + 1] * 3
    const c = indices[t + 2] * 3
    vol +=
      positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1]) -
      positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c]) +
      positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c])
  }
  return Math.abs(vol) / 6
}
