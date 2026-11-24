// Worker 客户端：单例 Worker + Promise 请求封装
import type { GridField, GridSpec } from './grid'
import type { ExtractionResult } from './marching_cubes'
import type { SensorPoint, Warehouse } from '../types'
import type { WorkerRequest, WorkerResponse } from './compute_worker'

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>()

const ensureWorker = (): Worker => {
  if (worker) return worker
  worker = new Worker(new URL('./compute_worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
    const msg = ev.data
    const id = (msg as unknown as { id?: number }).id
    if (id === undefined) return
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)
    if (msg.type === 'error') {
      entry.reject(new Error(msg.message))
    } else {
      entry.resolve(msg as never)
    }
  }
  worker.onerror = (ev) => {
    for (const { reject } of pending.values()) reject(new Error(ev.message))
    pending.clear()
  }
  return worker
}

const call = <T>(req: Omit<WorkerRequest, 'id'>): Promise<T> => {
  const w = ensureWorker()
  const id = ++seq
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: never) => void, reject })
    w.postMessage({ ...req, id })
  })
}

export const workerInterpolate = (
  warehouse: Warehouse,
  sensors: SensorPoint[],
  readings: Float32Array,
  invalid: Uint8Array,
  resolution: number,
): Promise<{ field: GridField }> =>
  call({ type: 'interpolate', payload: { warehouse, sensors, readings, invalid, resolution } })

export const workerExtract = (
  field: GridField,
  threshold: number,
  labelBlobs: boolean,
): Promise<{ result: ExtractionResult }> =>
  call({ type: 'extract', payload: { field, threshold, labelBlobs } })

export const workerBuildSpec = (
  warehouse: Warehouse,
  resolution: number,
): Promise<{ spec: GridSpec }> => call({ type: 'buildSpec', payload: { warehouse, resolution } })

export const workerBlend = (
  fieldA: GridField,
  fieldB: GridField,
  weight: number,
): Promise<{ field: GridField }> => call({ type: 'blend', payload: { fieldA, fieldB, weight } })

export const terminateWorker = (): void => {
  worker?.terminate()
  worker = null
  pending.clear()
}
