// 全局应用状态（轻量响应式，无框架）
import type { AppSettings, Warehouse } from '../types'
import { settingsRepo, warehouseRepo } from '../core/repository'
import { seedDemoData } from '../core/seed'

export interface AppState {
  warehouses: Warehouse[]
  currentWarehouseId: string | null
  settings: AppSettings
  ready: boolean
}

type Listener = () => void

const state: AppState = {
  warehouses: [],
  currentWarehouseId: null,
  settings: {
    gridResolution: 96,
    isoOffsets: [3, 5, 8],
    playbackFps: 4,
    theme: 'system',
    surfaceOpacity: 0.35,
    autoReinterpolate: true,
  },
  ready: false,
}

const listeners = new Set<Listener>()

export const getState = (): AppState => state

export const subscribe = (fn: Listener): (() => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const notify = (): void => {
  for (const fn of listeners) fn()
}

export const setState = (patch: Partial<AppState>): void => {
  Object.assign(state, patch)
  notify()
}

export const refreshWarehouses = async (): Promise<void> => {
  const warehouses = await warehouseRepo.list()
  setState({
    warehouses,
    currentWarehouseId: state.currentWarehouseId ?? warehouses[0]?.id ?? null,
  })
}

export const setCurrentWarehouse = (id: string): void => {
  setState({ currentWarehouseId: id })
}

export const updateSettings = async (patch: Partial<AppSettings>): Promise<void> => {
  const next = { ...state.settings, ...patch }
  state.settings = next
  await settingsRepo.save(next)
  notify()
}

export const initApp = async (): Promise<void> => {
  const settings = await settingsRepo.get()
  await seedDemoData()
  const warehouses = await warehouseRepo.list()
  setState({
    settings,
    warehouses,
    currentWarehouseId: warehouses[0]?.id ?? null,
    ready: true,
  })
  applyTheme(settings.theme)
}

export const applyTheme = (theme: AppSettings['theme']): void => {
  document.documentElement.dataset.theme = theme
}
