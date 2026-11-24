// 数据仓库：封装各实体的 IndexedDB 读写
import {
  STORES,
  iddBulkPut,
  idbClear,
  idbDelete,
  idbGet,
  idbGetAll,
  idbPut,
  idbQueryWarehouse,
} from './idb'
import type {
  AppSettings,
  Cable,
  HazardCase,
  HeatBlob,
  Inspection,
  SensorPoint,
  Warehouse,
} from '../types'
import { DEFAULT_SETTINGS } from '../types'

export const warehouseRepo = {
  list: () => idbGetAll<Warehouse>(STORES.warehouses),
  get: (id: string) => idbGet<Warehouse>(STORES.warehouses, id),
  save: (w: Warehouse) => idbPut(STORES.warehouses, w),
  remove: async (id: string) => {
    const cables = await idbQueryWarehouse<Cable>(STORES.cables, id)
    const sensors = await idbQueryWarehouse<SensorPoint>(STORES.sensors, id)
    const inspections = await idbQueryWarehouse<Inspection>(STORES.inspections, id)
    const blobs = await idbQueryWarehouse<HeatBlob>(STORES.blobs, id)
    const hazards = await idbQueryWarehouse<HazardCase>(STORES.hazards, id)
    for (const c of cables) await idbDelete(STORES.cables, c.id)
    for (const s of sensors) await idbDelete(STORES.sensors, s.id)
    for (const it of inspections) await idbDelete(STORES.inspections, it.id)
    for (const b of blobs) await idbDelete(STORES.blobs, b.id)
    for (const h of hazards) await idbDelete(STORES.hazards, h.id)
    await idbDelete(STORES.warehouses, id)
  },
}

export const cableRepo = {
  byWarehouse: (warehouseId: string) => idbQueryWarehouse<Cable>(STORES.cables, warehouseId),
  saveAll: (cables: Cable[]) => iddBulkPut(STORES.cables, cables),
}

export const sensorRepo = {
  byWarehouse: (warehouseId: string) => idbQueryWarehouse<SensorPoint>(STORES.sensors, warehouseId),
  saveAll: (sensors: SensorPoint[]) => iddBulkPut(STORES.sensors, sensors),
}

export const inspectionRepo = {
  byWarehouse: async (warehouseId: string): Promise<Inspection[]> => {
    const list = await idbQueryWarehouse<Inspection>(STORES.inspections, warehouseId)
    return list.sort((a, b) => a.date.localeCompare(b.date))
  },
  save: (insp: Inspection) => idbPut(STORES.inspections, insp),
  saveAll: (list: Inspection[]) => iddBulkPut(STORES.inspections, list),
  remove: (id: string) => idbDelete(STORES.inspections, id),
}

export const blobRepo = {
  byWarehouse: (warehouseId: string) => idbQueryWarehouse<HeatBlob>(STORES.blobs, warehouseId),
  saveAll: (blobs: HeatBlob[]) => iddBulkPut(STORES.blobs, blobs),
  clearWarehouse: async (warehouseId: string) => {
    const list = await idbQueryWarehouse<HeatBlob>(STORES.blobs, warehouseId)
    for (const b of list) await idbDelete(STORES.blobs, b.id)
  },
}

export const hazardRepo = {
  list: () => idbGetAll<HazardCase>(STORES.hazards),
  byWarehouse: (warehouseId: string) => idbQueryWarehouse<HazardCase>(STORES.hazards, warehouseId),
  save: (h: HazardCase) => idbPut(STORES.hazards, h),
  remove: (id: string) => idbDelete(STORES.hazards, id),
}

const SETTINGS_ID = 'app-settings'

export const settingsRepo = {
  get: async (): Promise<AppSettings> => {
    const s = await idbGet<AppSettings>(STORES.settings, SETTINGS_ID)
    return s ?? DEFAULT_SETTINGS
  },
  save: (s: AppSettings) => idbPut(STORES.settings, { ...s, id: SETTINGS_ID }),
}

export const resetAllData = async (): Promise<void> => {
  for (const store of Object.values(STORES)) {
    if (store !== STORES.settings) await idbClear(store)
  }
}
