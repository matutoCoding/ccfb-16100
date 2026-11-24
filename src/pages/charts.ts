// Canvas2D 图表：测点历史曲线、剖面等温线
import type { GridField } from '../core/grid'
import { nodeIndex, nodePos } from '../core/grid'
import type { Warehouse } from '../types'
import { insideGrain } from '../core/geometry'

export interface HistoryPoint {
  date: string
  value: number
}

// 测点历史温度曲线
export const drawHistoryCurve = (canvas: HTMLCanvasElement, series: HistoryPoint[]): void => {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const dpr = Math.min(window.devicePixelRatio, 2)
  const w = canvas.clientWidth || 520
  const h = canvas.clientHeight || 280
  canvas.width = w * dpr
  canvas.height = h * dpr
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, w, h)

  const padL = 48
  const padR = 16
  const padT = 20
  const padB = 40
  const plotW = w - padL - padR
  const plotH = h - padT - padB

  const valid = series.filter((p) => Number.isFinite(p.value))
  if (valid.length < 2) {
    ctx.fillStyle = '#94a3b8'
    ctx.font = '14px sans-serif'
    ctx.fillText('有效数据不足', w / 2 - 40, h / 2)
    return
  }
  const values = valid.map((p) => p.value)
  let min = Math.min(...values)
  let max = Math.max(...values)
  const span = Math.max(0.5, max - min)
  min -= span * 0.15
  max += span * 0.15

  // 网格 + y 轴刻度
  ctx.strokeStyle = '#e2e8f0'
  ctx.fillStyle = '#64748b'
  ctx.font = '11px sans-serif'
  ctx.lineWidth = 1
  for (let i = 0; i <= 4; i++) {
    const y = padT + (plotH * i) / 4
    const val = max - ((max - min) * i) / 4
    ctx.beginPath()
    ctx.moveTo(padL, y)
    ctx.lineTo(w - padR, y)
    ctx.stroke()
    ctx.fillText(val.toFixed(1), 8, y + 4)
  }

  const xAt = (i: number) => padL + (plotW * i) / (valid.length - 1)
  const yAt = (v: number) => padT + plotH * (1 - (v - min) / (max - min))

  // 折线
  ctx.strokeStyle = '#2563eb'
  ctx.lineWidth = 2
  ctx.beginPath()
  valid.forEach((p, i) => {
    const x = xAt(i)
    const y = yAt(p.value)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()

  // 数据点
  ctx.fillStyle = '#2563eb'
  valid.forEach((p, i) => {
    ctx.beginPath()
    ctx.arc(xAt(i), yAt(p.value), 2.5, 0, Math.PI * 2)
    ctx.fill()
  })

  // x 轴日期（稀疏）
  ctx.fillStyle = '#64748b'
  const tickCount = Math.min(6, valid.length)
  for (let i = 0; i < tickCount; i++) {
    const idx = Math.floor(((valid.length - 1) * i) / (tickCount - 1))
    const label = valid[idx].date.slice(5)
    ctx.fillText(label, xAt(idx) - 16, h - padB + 16)
  }
  ctx.fillStyle = '#475569'
  ctx.font = '12px sans-serif'
  ctx.fillText('温度 (℃)', 8, padT - 6)
}

// 剖面等温线：沿指定轴取剖面，在二维网格上画等温线（marching squares 简化版）
export const drawIsothermSlice = async (
  canvas: HTMLCanvasElement,
  field: GridField,
  warehouse: Warehouse,
  axis: 'x' | 'y' | 'z',
  posRatio: number,
  thresholds: number[],
): Promise<void> => {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const dpr = Math.min(window.devicePixelRatio, 2)
  const w = canvas.clientWidth || 260
  const h = canvas.clientHeight || 200
  canvas.width = w * dpr
  canvas.height = h * dpr
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, w, h)

  const { spec, values, mask } = field
  const sliceIndex = Math.round(posRatio * (axis === 'x' ? spec.nx - 1 : axis === 'y' ? spec.ny - 1 : spec.nz - 1))

  // 取剖面二维网格
  const uMax = axis === 'x' ? spec.ny : spec.nx
  const vMax = axis === 'z' ? spec.nz : axis === 'x' ? spec.nz : spec.ny
  const grid: number[][] = []
  const validMask: boolean[][] = []
  for (let u = 0; u < uMax; u++) {
    grid[u] = []
    validMask[u] = []
    for (let v = 0; v < vMax; v++) {
      let idx = 0
      if (axis === 'x') idx = nodeIndex(spec, sliceIndex, u, v)
      else if (axis === 'y') idx = nodeIndex(spec, u, sliceIndex, v)
      else idx = nodeIndex(spec, u, v, sliceIndex)
      grid[u][v] = values[idx]
      validMask[u][v] = mask[idx] === 1
    }
  }

  const pad = 12
  const sx = (w - pad * 2) / uMax
  const sy = (h - pad * 2) / vMax
  const colors = ['#e85c3d', '#ed8c2e', '#d4333d']

  // 背景：粮堆区域
  ctx.fillStyle = '#f1f5f9'
  ctx.fillRect(pad, pad, uMax * sx, vMax * sy)

  // marching squares 逐格画等温线段
  thresholds.forEach((threshold, ti) => {
    ctx.strokeStyle = colors[ti] ?? colors[0]
    ctx.lineWidth = 1.8
    ctx.beginPath()
    for (let u = 0; u < uMax - 1; u++) {
      for (let v = 0; v < vMax - 1; v++) {
        if (!validMask[u][v] || !validMask[u + 1][v] || !validMask[u][v + 1] || !validMask[u + 1][v + 1]) continue
        const a = grid[u][v]
        const b = grid[u + 1][v]
        const c = grid[u + 1][v + 1]
        const d = grid[u][v + 1]
        const pts: [number, number][] = []
        const interp = (p: number, q: number) => (threshold - p) / (q - p)
        if ((a >= threshold) !== (b >= threshold)) {
          const t = interp(a, b)
          pts.push([pad + (u + t) * sx, pad + v * sy])
        }
        if ((b >= threshold) !== (c >= threshold)) {
          const t = interp(b, c)
          pts.push([pad + (u + 1) * sx, pad + (v + t) * sy])
        }
        if ((c >= threshold) !== (d >= threshold)) {
          const t = interp(c, d)
          pts.push([pad + (u + t) * sx, pad + (v + 1) * sy])
        }
        if ((d >= threshold) !== (a >= threshold)) {
          const t = interp(d, a)
          pts.push([pad + u * sx, pad + (v + t) * sy])
        }
        if (pts.length === 2) {
          ctx.moveTo(pts[0][0], pts[0][1])
          ctx.lineTo(pts[1][0], pts[1][1])
        } else if (pts.length === 4) {
          ctx.moveTo(pts[0][0], pts[0][1])
          ctx.lineTo(pts[1][0], pts[1][1])
          ctx.moveTo(pts[2][0], pts[2][1])
          ctx.lineTo(pts[3][0], pts[3][1])
        }
      }
    }
    ctx.stroke()
  })

  // 图例
  ctx.font = '10px sans-serif'
  thresholds.forEach((t, i) => {
    ctx.fillStyle = colors[i] ?? colors[0]
    ctx.fillRect(pad + i * 64, 2, 8, 8)
    ctx.fillStyle = '#475569'
    ctx.fillText(`${t.toFixed(1)}℃`, pad + i * 64 + 12, 10)
  })
}
