// 仓房几何：粮面拟合、粮堆边界、电缆布置生成
import type { Cable, SensorPoint, Warehouse } from '../types'
import { idw2d } from './math_utils'

export interface Bounds {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

// 仓内局部坐标范围：平房仓按长宽，浅圆仓按直径
export const warehouseBounds = (w: Warehouse): Bounds => {
  if (w.type === 'rect') {
    return { minX: 0, minY: 0, minZ: 0, maxX: w.length, maxY: w.width, maxZ: w.wallHeight }
  }
  const r = w.diameter / 2
  return { minX: -r, minY: -r, minZ: 0, maxX: r, maxY: r, maxZ: w.wallHeight }
}

// 粮面高程：实测控制点 IDW 拟合；无控制点时退回装粮线
export const surfaceHeight = (w: Warehouse, x: number, y: number): number => {
  if (w.surfacePoints.length === 0) return w.fillLine
  return idw2d(x, y, w.surfacePoints)
}

// 点是否在仓壁以内（不含粮面判断）
export const insideWall = (w: Warehouse, x: number, y: number): boolean => {
  if (w.type === 'rect') return x >= 0 && x <= w.length && y >= 0 && y <= w.width
  const r = w.diameter / 2
  return x * x + y * y <= r * r
}

// 点是否在粮堆内部（粮面以下、地坪以上、仓壁以内）
export const insideGrain = (w: Warehouse, x: number, y: number, z: number): boolean => {
  if (z < 0) return false
  if (!insideWall(w, x, y)) return false
  return z <= surfaceHeight(w, x, y)
}

// 平房仓：行列网格式布缆，距墙留边距，间距约 4~5 米
export const layoutRectCables = (
  w: Warehouse,
  margin = 1.2,
  spacing = 4.5,
  spacingZ = 1,
  firstDepth = 0.5,
): { cables: Cable[]; sensors: SensorPoint[] } => {
  const cables: Cable[] = []
  const sensors: SensorPoint[] = []
  const usableX = w.length - margin * 2
  const usableY = w.width - margin * 2
  const cols = Math.max(2, Math.round(usableX / spacing) + 1)
  const rows = Math.max(2, Math.round(usableY / spacing) + 1)

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = margin + (cols === 1 ? usableX / 2 : (usableX * c) / (cols - 1))
      const y = margin + (rows === 1 ? usableY / 2 : (usableY * r) / (rows - 1))
      const code = `R${String(r + 1).padStart(2, '0')}C${String(c + 1).padStart(2, '0')}`
      const grainTop = surfaceHeight(w, x, y)
      const pointCount = Math.max(2, Math.floor((grainTop - firstDepth) / spacingZ) + 1)
      const cable: Cable = {
        id: `${w.id}-cb-${code}`,
        warehouseId: w.id,
        code,
        ring: 0,
        x,
        y,
        topZ: w.wallHeight,
        pointCount,
        spacing: spacingZ,
        firstDepth,
        status: 'ok',
      }
      cables.push(cable)
      for (let i = 0; i < pointCount; i++) {
        sensors.push({
          id: `${cable.id}-P${String(i).padStart(2, '0')}`,
          cableId: cable.id,
          warehouseId: w.id,
          index: i,
          x,
          y,
          z: grainTop - firstDepth - i * spacingZ,
          status: 'ok',
        })
      }
    }
  }
  return { cables, sensors }
}

// 浅圆仓：同心圈布缆，中心 1 根 + 各圈均布
export const layoutSiloCables = (
  w: Warehouse,
  margin = 1.0,
  ringSpacing = 4.0,
  spacingZ = 1,
  firstDepth = 0.5,
): { cables: Cable[]; sensors: SensorPoint[] } => {
  const cables: Cable[] = []
  const sensors: SensorPoint[] = []
  const radius = w.diameter / 2 - margin
  const ringCount = Math.max(1, Math.floor(radius / ringSpacing))

  const pushCable = (ring: number, seq: number, x: number, y: number) => {
    const code = ring === 0 ? 'CENTER' : `RING${ring}-${String(seq).padStart(2, '0')}`
    const grainTop = surfaceHeight(w, x, y)
    const pointCount = Math.max(2, Math.floor((grainTop - firstDepth) / spacingZ) + 1)
    const cable: Cable = {
      id: `${w.id}-cb-${code}`,
      warehouseId: w.id,
      code,
      ring,
      x,
      y,
      topZ: w.wallHeight,
      pointCount,
      spacing: spacingZ,
      firstDepth,
      status: 'ok',
    }
    cables.push(cable)
    for (let i = 0; i < pointCount; i++) {
      sensors.push({
        id: `${cable.id}-P${String(i).padStart(2, '0')}`,
        cableId: cable.id,
        warehouseId: w.id,
        index: i,
        x,
        y,
        z: grainTop - firstDepth - i * spacingZ,
        status: 'ok',
      })
    }
  }

  pushCable(0, 0, 0, 0)
  for (let ring = 1; ring <= ringCount; ring++) {
    const rr = (radius * ring) / ringCount
    const n = Math.max(6, Math.round((2 * Math.PI * rr) / ringSpacing))
    for (let k = 0; k < n; k++) {
      const ang = (2 * Math.PI * k) / n + (ring % 2) * (Math.PI / n)
      pushCable(ring, k + 1, rr * Math.cos(ang), rr * Math.sin(ang))
    }
  }
  return { cables, sensors }
}

export const layoutCables = (w: Warehouse) =>
  w.type === 'rect' ? layoutRectCables(w) : layoutSiloCables(w)
