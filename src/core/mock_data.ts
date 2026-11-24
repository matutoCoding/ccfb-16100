// 合成测试数据：一个仓一年，含三处典型异常 + 坏点/断线
import type { Cable, Inspection, SensorPoint, Warehouse } from '../types'
import { gaussian3, mulberry32 } from './math_utils'

export interface AnomalySpec {
  kind: 'deep-heat' | 'wall-heat' | 'condensation'
  cx: number
  cy: number
  cz: number
  sx: number
  sy: number
  sz: number
  peak: number // 峰值幅度
}

// 季节环境温度（北半球，7 月最热），t 为一年中的相位 0..1
export const seasonalAmbient = (t: number): number =>
  6 + 20 * Math.cos(2 * Math.PI * (t - 0.55))

const dayOfYearPhase = (date: Date): number => {
  const start = Date.UTC(date.getFullYear(), 0, 0)
  const diff = date.getTime() - start
  return ((diff / 86400000) % 365) / 365
}

// 单点温度场：基础场 + 异常叠加
const sampleTemp = (
  w: Warehouse,
  p: SensorPoint,
  date: Date,
  anomalies: AnomalySpec[],
  rng: () => number,
): number => {
  const t = dayOfYearPhase(date)
  const ambient = seasonalAmbient(t)
  const depth = Math.max(0, w.fillLine - p.z) // 距粮面深度
  // 深层受外界影响衰减（特征深度 4 米），粮温整体滞后约 30 天
  const lagT = t - 30 / 365
  const base =
    14 +
    8 * Math.exp(-depth / 4) * Math.cos(2 * Math.PI * (lagT - 0.55)) +
    0.4 * ambient * Math.exp(-depth / 6)
  let temp = base + (rng() - 0.5) * 0.25

  for (const a of anomalies) {
    const g = gaussian3(p.x, p.y, p.z, a.cx, a.cy, a.cz, a.sx, a.sy, a.sz)
    if (a.kind === 'deep-heat') {
      // 第 60~300 天缓慢发展，发热团整体上移
      const dayIdx = Math.floor((date.getTime() - Date.UTC(date.getFullYear(), 0, 1)) / 86400000)
      const grow = Math.max(0, Math.min(1, (dayIdx - 60) / 120)) * (1 - Math.max(0, (dayIdx - 300) / 65))
      const rise = grow * 1.6 // 中心随时间上移 1.6m
      const gg = gaussian3(p.x, p.y, p.z, a.cx, a.cy, a.cz + rise, a.sx, a.sy, a.sz)
      temp += a.peak * grow * gg
    } else if (a.kind === 'wall-heat') {
      // 仅夏季（5~9 月）南墙晒热，浅表层最强
      const summer = Math.max(0, Math.sin(Math.PI * Math.max(0, (t - 0.32) / 0.4)))
      temp += a.peak * summer * g
    } else if (a.kind === 'condensation') {
      // 粮面结露：秋冬表层温度骤降，形成低温区（显示为冷团）
      const cold = Math.max(0, Math.cos(2 * Math.PI * (t - 0.95)))
      temp -= a.peak * cold * g
    }
  }
  return temp
}

// 为一个仓生成全年巡测（每 3 天一次，共约 122 次）
export const generateInspections = (
  w: Warehouse,
  cables: Cable[],
  sensors: SensorPoint[],
  anomalies: AnomalySpec[],
  opts: { seed?: number; intervalDays?: number; badRatio?: number; year?: number } = {},
): { inspections: Inspection[]; badIds: Set<string>; offlineCableIds: Set<string> } => {
  const seed = opts.seed ?? 20260101
  const intervalDays = opts.intervalDays ?? 3
  const badRatio = opts.badRatio ?? 0.008
  const year = opts.year ?? 2026
  const rng = mulberry32(seed)

  // 固定坏点（传感器老化）与断线整缆
  const badIds = new Set<string>()
  const offlineCableIds = new Set<string>()
  for (const s of sensors) {
    if (rng() < badRatio) badIds.add(s.id)
  }
  const onlineCables = cables.filter((c) => c.status === 'ok')
  if (onlineCables.length > 4) {
    offlineCableIds.add(onlineCables[Math.floor(rng() * onlineCables.length)].id)
  }

  const inspections: Inspection[] = []
  const start = new Date(Date.UTC(year, 0, 1))
  const count = Math.floor(365 / intervalDays)
  for (let k = 0; k < count; k++) {
    const date = new Date(start.getTime() + k * intervalDays * 86400000)
    const readings = new Float32Array(sensors.length)
    const badPointIds: string[] = []
    const phase = dayOfYearPhase(date)
    for (let i = 0; i < sensors.length; i++) {
      const s = sensors[i]
      if (badIds.has(s.id) || offlineCableIds.has(s.cableId)) {
        readings[i] = NaN
        badPointIds.push(s.id)
        continue
      }
      readings[i] = sampleTemp(w, s, date, anomalies, rng)
    }
    inspections.push({
      id: `${w.id}-insp-${String(k).padStart(3, '0')}`,
      warehouseId: w.id,
      date: date.toISOString().slice(0, 10),
      pointCount: sensors.length,
      readings,
      ambientTemp: seasonalAmbient(phase),
      badPointIds,
      createdAt: new Date().toISOString(),
    })
  }
  return { inspections, badIds, offlineCableIds }
}

// 两个仓的异常布点
export const rectAnomalies = (w: Warehouse): AnomalySpec[] => [
  {
    kind: 'deep-heat',
    cx: w.length * 0.42,
    cy: w.width * 0.55,
    cz: 1.6,
    sx: 2.6,
    sy: 2.2,
    sz: 1.8,
    peak: 11,
  },
  {
    kind: 'wall-heat',
    cx: w.length * 0.5,
    cy: 0.4,
    cz: w.fillLine * 0.55,
    sx: w.length * 0.42,
    sy: 0.9,
    sz: 2.4,
    peak: 6.5,
  },
  {
    kind: 'condensation',
    cx: w.length * 0.78,
    cy: w.width * 0.3,
    cz: w.fillLine - 0.4,
    sx: 3.2,
    sy: 2.6,
    sz: 0.9,
    peak: 4.5,
  },
]

export const siloAnomalies = (w: Warehouse): AnomalySpec[] => {
  const r = w.diameter / 2
  return [
    {
      kind: 'deep-heat',
      cx: r * 0.25,
      cy: -r * 0.2,
      cz: 2.0,
      sx: 2.2,
      sy: 2.2,
      sz: 2.0,
      peak: 10,
    },
    {
      kind: 'wall-heat',
      cx: 0,
      cy: r - 0.4,
      cz: w.fillLine * 0.5,
      sx: r * 0.8,
      sy: 0.9,
      sz: 2.2,
      peak: 6,
    },
    {
      kind: 'condensation',
      cx: -r * 0.4,
      cy: r * 0.3,
      cz: w.fillLine - 0.5,
      sx: 2.4,
      sy: 2.4,
      sz: 0.9,
      peak: 4,
    },
  ]
}
