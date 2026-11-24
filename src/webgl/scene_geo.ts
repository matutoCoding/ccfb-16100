// 场景几何构建：仓壁线框、粮面网格线、电缆+测点线段
import type { Cable, SensorPoint, Warehouse } from '../types'
import { warehouseBounds } from '../core/geometry'
import { buildSurfaceMesh } from '../core/grid'
import type { GridSpec } from '../core/grid'

// 仓壁 12 条棱
export const buildWallLines = (w: Warehouse): Float32Array => {
  const b = warehouseBounds(w)
  const corners = [
    [b.minX, b.minY, b.minZ], [b.maxX, b.minY, b.minZ],
    [b.maxX, b.maxY, b.minZ], [b.minX, b.maxY, b.minZ],
    [b.minX, b.minY, b.maxZ], [b.maxX, b.minY, b.maxZ],
    [b.maxX, b.maxY, b.maxZ], [b.minX, b.maxY, b.maxZ],
  ]
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ]
  const out: number[] = []
  for (const [a, c] of edges) {
    out.push(...corners[a], ...corners[c])
  }
  return new Float32Array(out)
}

// 电缆竖线（从粮面首点到末点）
export const buildCableLines = (
  cables: Cable[],
  sensors: SensorPoint[],
): Float32Array => {
  const byCable = new Map<string, SensorPoint[]>()
  for (const s of sensors) {
    const arr = byCable.get(s.cableId) ?? []
    arr.push(s)
    byCable.set(s.cableId, arr)
  }
  const out: number[] = []
  for (const cable of cables) {
    const pts = byCable.get(cable.id)
    if (!pts || pts.length < 2) continue
    pts.sort((a, b) => b.z - a.z)
    const top = pts[0]
    const bottom = pts[pts.length - 1]
    out.push(top.x, top.y, top.z, bottom.x, bottom.y, bottom.z)
  }
  return new Float32Array(out)
}

// 测点坐标（可按状态过滤）
export const buildSensorPoints = (sensors: SensorPoint[]): Float32Array => {
  const out = new Float32Array(sensors.length * 3)
  sensors.forEach((s, i) => {
    out[i * 3] = s.x
    out[i * 3 + 1] = s.y
    out[i * 3 + 2] = s.z
  })
  return out
}

// 粮面网格线（由三角网格转线框）
export const buildSurfaceLines = (w: Warehouse, spec: GridSpec): Float32Array => {
  const mesh = buildSurfaceMesh(w, spec)
  const out: number[] = []
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const tri = [mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]]
    for (let q = 0; q < 3; q++) {
      const a = tri[q]
      const b = tri[(q + 1) % 3]
      out.push(
        mesh.positions[a * 3], mesh.positions[a * 3 + 1], mesh.positions[a * 3 + 2],
        mesh.positions[b * 3], mesh.positions[b * 3 + 1], mesh.positions[b * 3 + 2],
      )
    }
  }
  return new Float32Array(out)
}

// 命中检测：把屏幕射线近似为最近测点（返回测点 id 或 null）
export const pickSensor = (
  sensors: SensorPoint[],
  worldPoint: { x: number; y: number; z: number },
  tolerance = 0.8,
): SensorPoint | null => {
  let best: SensorPoint | null = null
  let bestD = tolerance
  for (const s of sensors) {
    const d = Math.hypot(s.x - worldPoint.x, s.y - worldPoint.y, s.z - worldPoint.z)
    if (d < bestD) {
      bestD = d
      best = s
    }
  }
  return best
}
