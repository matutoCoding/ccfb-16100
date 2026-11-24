// 三维计算 Worker：接收标量场插值与等值面抽取任务，避免阻塞主线程
import { GridField, GridSpec, buildGridSpec, interpolateField, sealFieldForIsosurface } from './grid'
import { extractIsosurface, ExtractionResult } from './marching_cubes'
import type { SensorPoint, Warehouse } from '../types'

export type WorkerRequest =
  | {
      type: 'interpolate'
      payload: {
        warehouse: Warehouse
        sensors: SensorPoint[]
        readings: Float32Array
        invalid: Uint8Array
        resolution: number
      }
    }
  | {
      type: 'extract'
      payload: { field: GridField; threshold: number; labelBlobs: boolean }
    }
  | {
      // 两次巡测标量场按权重时间插值，生成过渡帧
      type: 'blend'
      payload: { fieldA: GridField; fieldB: GridField; weight: number }
    }
  | {
      type: 'buildSpec'
      payload: { warehouse: Warehouse; resolution: number }
    }

export type WorkerResponse =
  | { type: 'field'; field: GridField }
  | { type: 'extraction'; result: ExtractionResult }
  | { type: 'spec'; spec: GridSpec }
  | { type: 'error'; message: string }

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data
  try {
    if (msg.type === 'interpolate') {
      const { warehouse, sensors, readings, invalid, resolution } = msg.payload
      const spec = buildGridSpec(warehouse, resolution)
      const field = interpolateField({ warehouse, sensors, readings, spec, invalid })
      const resp: WorkerResponse = { type: 'field', field }
      self.postMessage(resp)
    } else if (msg.type === 'extract') {
      const { field, threshold, labelBlobs } = msg.payload
      // 封闭化：粮堆外与 domain 边界赋冷值，等值面沿边界收口，保证水密
      const sealed = sealFieldForIsosurface(field, threshold)
      const result = extractIsosurface(sealed, { threshold, labelBlobs })
      const resp: WorkerResponse = { type: 'extraction', result }
      self.postMessage(resp)
    } else if (msg.type === 'buildSpec') {
      const spec = buildGridSpec(msg.payload.warehouse, msg.payload.resolution)
      const resp: WorkerResponse = { type: 'spec', spec }
      self.postMessage(resp)
    } else if (msg.type === 'blend') {
      const { fieldA, fieldB, weight } = msg.payload
      const values = new Float32Array(fieldA.values.length)
      for (let i = 0; i < values.length; i++) {
        values[i] = fieldA.values[i] * (1 - weight) + fieldB.values[i] * weight
      }
      const blended: GridField = {
        ...fieldA,
        values,
        // 分块极值取两场并集，避免裁剪误跳
        chunkMin: fieldA.chunkMin.map((v, i) => Math.min(v, fieldB.chunkMin[i])),
        chunkMax: fieldA.chunkMax.map((v, i) => Math.max(v, fieldB.chunkMax[i])),
      }
      self.postMessage({ type: 'field', field: blended } satisfies WorkerResponse)
    }
  } catch (err) {
    const resp: WorkerResponse = {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    }
    self.postMessage(resp)
  }
}
