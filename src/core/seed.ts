// 种子数据：两个示范仓（平房仓 + 浅圆仓），含电缆布置、测点、全年巡测
import type { Cable, Inspection, SensorPoint, Warehouse } from '../types'
import { layoutCables } from './geometry'
import { generateInspections, rectAnomalies, siloAnomalies } from './mock_data'
import { cableRepo, inspectionRepo, sensorRepo, warehouseRepo } from './repository'

const uid = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`

// 平房仓：靠门一端（x 较小处）粮面被扒低，用实测控制点拟合
const buildRectWarehouse = (): Warehouse => {
  const w: Warehouse = {
    id: 'wh-rect-01',
    name: '1号平房仓',
    type: 'rect',
    length: 30,
    width: 18,
    diameter: 0,
    wallHeight: 8,
    fillLine: 6,
    grainType: 'wheat',
    inboundDate: '2025-11-15',
    moisture: 12.4,
    bulkDensity: 780,
    surfacePoints: [
      // 正常区粮面 6m，靠门(x<8)扒低到 4.8~5.2
      { x: 2, y: 2, z: 4.9 },
      { x: 2, y: 9, z: 4.8 },
      { x: 2, y: 16, z: 5.1 },
      { x: 8, y: 3, z: 5.6 },
      { x: 8, y: 15, z: 5.7 },
      { x: 15, y: 4, z: 6.0 },
      { x: 15, y: 14, z: 6.0 },
      { x: 24, y: 3, z: 6.1 },
      { x: 24, y: 9, z: 6.0 },
      { x: 24, y: 15, z: 6.1 },
      { x: 28, y: 9, z: 6.0 },
    ],
    createdAt: new Date().toISOString(),
  }
  return w
}

// 浅圆仓：中心锥形堆尖
const buildSiloWarehouse = (): Warehouse => {
  const r = 10
  const w: Warehouse = {
    id: 'wh-silo-01',
    name: '2号浅圆仓',
    type: 'silo',
    length: 0,
    width: 0,
    diameter: 20,
    wallHeight: 12,
    fillLine: 9,
    grainType: 'corn',
    inboundDate: '2025-12-01',
    moisture: 14.1,
    bulkDensity: 720,
    surfacePoints: [
      // 锥尖中心 10.5，向边缘降到 8.6
      { x: 0, y: 0, z: 10.5 },
      { x: r * 0.4, y: 0, z: 10.0 },
      { x: -r * 0.4, y: 0, z: 10.0 },
      { x: 0, y: r * 0.4, z: 10.0 },
      { x: 0, y: -r * 0.4, z: 10.0 },
      { x: r * 0.75, y: r * 0.75, z: 9.2 },
      { x: -r * 0.75, y: r * 0.75, z: 9.2 },
      { x: r * 0.75, y: -r * 0.75, z: 9.2 },
      { x: -r * 0.75, y: -r * 0.75, z: 9.2 },
      { x: r - 0.6, y: 0, z: 8.7 },
      { x: 0, y: r - 0.6, z: 8.7 },
    ],
    createdAt: new Date().toISOString(),
  }
  return w
}

const seedWarehouse = async (
  w: Warehouse,
  seed: number,
): Promise<{ cableCount: number; sensorCount: number; inspectionCount: number; badCount: number }> => {
  const { cables, sensors } = layoutCables(w)
  const anomalies = w.type === 'rect' ? rectAnomalies(w) : siloAnomalies(w)
  const { inspections, badIds, offlineCableIds } = generateInspections(w, cables, sensors, anomalies, {
    seed,
    intervalDays: 3,
  })

  // 把坏点/断线状态写回传感器与电缆档案
  for (const s of sensors) {
    if (badIds.has(s.id)) s.status = 'bad'
    if (offlineCableIds.has(s.cableId)) s.status = 'offline'
  }
  for (const c of cables) {
    if (offlineCableIds.has(c.id)) c.status = 'offline'
  }

  await warehouseRepo.save(w)
  await cableRepo.saveAll(cables)
  await sensorRepo.saveAll(sensors)
  await inspectionRepo.saveAll(inspections)

  return {
    cableCount: cables.length,
    sensorCount: sensors.length,
    inspectionCount: inspections.length,
    badCount: badIds.size + sensors.filter((s) => s.status === 'offline').length,
  }
}

export const seedDemoData = async (): Promise<void> => {
  const existing = await warehouseRepo.list()
  if (existing.length > 0) return
  const rect = buildRectWarehouse()
  const silo = buildSiloWarehouse()
  await seedWarehouse(rect, 20260101)
  await seedWarehouse(silo, 20260202)
}

// 重新生成指定仓的巡测（设置页/调试用）
export const regenerateWarehouseData = async (warehouseId: string): Promise<void> => {
  const w = await warehouseRepo.get(warehouseId)
  if (!w) return
  const cables = await cableRepo.byWarehouse(warehouseId)
  const sensors = await sensorRepo.byWarehouse(warehouseId)
  const anomalies = w.type === 'rect' ? rectAnomalies(w) : siloAnomalies(w)
  const { inspections } = generateInspections(w, cables, sensors, anomalies, {
    seed: hashWarehouse(warehouseId),
    intervalDays: 3,
  })
  await inspectionRepo.saveAll(inspections)
}

const hashWarehouse = (id: string): number => {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0
  return h || 20260101
}

export const newWarehouseId = (): string => uid('wh')
