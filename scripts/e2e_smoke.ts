// 端到端管线冒烟：种子仓 -> 电缆测点 -> 全年巡测 -> 网格插值 -> 多层等值面 -> 发热团
// 不依赖 WebGL，验证纯数据与算法链路在真实仓房几何下成立
import { layoutCables } from '../src/core/geometry'
import { buildGridSpec, interpolateField, countGridVolume, nodeIndex, sealFieldForIsosurface } from '../src/core/grid'
import { extractIsosurface, meshVolumeSigned } from '../src/core/marching_cubes'
import { generateInspections, rectAnomalies, siloAnomalies } from '../src/core/mock_data'
import type { Warehouse } from '../src/types'

const rect: Warehouse = {
  id: 'e2e-rect', name: 'E2E平房仓', type: 'rect',
  length: 30, width: 18, diameter: 0, wallHeight: 8, fillLine: 6,
  grainType: 'wheat', inboundDate: '2025-11-15', moisture: 12.4, bulkDensity: 780,
  surfacePoints: [
    { x: 2, y: 2, z: 4.9 }, { x: 2, y: 16, z: 5.1 }, { x: 8, y: 9, z: 5.6 },
    { x: 15, y: 4, z: 6 }, { x: 24, y: 15, z: 6.1 }, { x: 28, y: 9, z: 6 },
  ],
  createdAt: new Date().toISOString(),
}

const silo: Warehouse = {
  id: 'e2e-silo', name: 'E2E浅圆仓', type: 'silo',
  length: 0, width: 0, diameter: 20, wallHeight: 12, fillLine: 9,
  grainType: 'corn', inboundDate: '2025-12-01', moisture: 14.1, bulkDensity: 720,
  surfacePoints: [
    { x: 0, y: 0, z: 10.5 }, { x: 4, y: 0, z: 10 }, { x: -4, y: 0, z: 10 },
    { x: 7.5, y: 7.5, z: 9.2 }, { x: 9.4, y: 0, z: 8.7 }, { x: 0, y: 9.4, z: 8.7 },
  ],
  createdAt: new Date().toISOString(),
}

const run = (w: Warehouse, resolution: number) => {
  const { cables, sensors } = layoutCables(w)
  const anomalies = w.type === 'rect' ? rectAnomalies(w) : siloAnomalies(w)
  const { inspections, badIds, offlineCableIds } = generateInspections(w, cables, sensors, anomalies, { intervalDays: 6 })
  const invalid = new Uint8Array(sensors.length)
  sensors.forEach((s, i) => {
    if (badIds.has(s.id) || offlineCableIds.has(s.cableId)) invalid[i] = 1
  })

  // 取发热最明显的中后期一次巡测
  const insp = inspections[Math.floor(inspections.length * 0.7)]
  const spec = buildGridSpec(w, resolution)
  const field = interpolateField({ warehouse: w, sensors, readings: insp.readings, spec, invalid })

  // 确认坏点没污染：插值结果全部有限且在合理温度区间
  let nanCount = 0
  let outOfRange = 0
  for (let i = 0; i < field.values.length; i++) {
    if (!field.mask[i]) continue
    if (Number.isNaN(field.values[i])) nanCount++
    if (field.values[i] < -20 || field.values[i] > 60) outOfRange++
  }

  // 多层等值面（相对该次最低温 +3/+5/+8）
  let minTemp = Infinity
  for (const v of insp.readings) if (Number.isFinite(v)) minTemp = Math.min(minTemp, v)
  const layers = [3, 5, 8].map((off) => {
    const threshold = minTemp + off
    const sealed = sealFieldForIsosurface(field, threshold)
    const result = extractIsosurface(sealed, { threshold, labelBlobs: true })
    const meshVol = meshVolumeSigned(result.mesh)
    const gridVol = countGridVolume(sealed, threshold)
    const diff = result.mesh.triangleCount > 0 ? Math.abs(meshVol - gridVol) / Math.max(gridVol, 1e-6) * 100 : 0
    return { off, threshold, triangles: result.mesh.triangleCount, blobs: result.blobs.length, gridVol, diff, ms: result.ms }
  })

  // 水密检查（封闭化后的场）
  const edgeCount = new Map<number, number>()
  for (const layer of layers) {
    const sealed = sealFieldForIsosurface(field, layer.threshold)
    const result = extractIsosurface(sealed, { threshold: layer.threshold, labelBlobs: false })
    for (let t = 0; t < result.mesh.indices.length; t += 3) {
      const tri = [result.mesh.indices[t], result.mesh.indices[t + 1], result.mesh.indices[t + 2]]
      for (let q = 0; q < 3; q++) {
        const a = tri[q]
        const b = tri[(q + 1) % 3]
        const key = Math.min(a, b) * 400000007 + Math.max(a, b)
        edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1)
      }
    }
  }
  let boundary = 0
  for (const c of edgeCount.values()) if (c === 1) boundary++

  return {
    cables: cables.length,
    sensors: sensors.length,
    inspections: inspections.length,
    invalid: invalid.reduce((a, b) => a + b, 0),
    insideNodes: field.insideNodes,
    nanCount,
    outOfRange,
    layers,
    boundary,
  }
}

console.log('=== 端到端管线冒烟（真实仓房几何）===\n')
for (const w of [rect, silo]) {
  const r = run(w, 80)
  console.log(`【${w.name}】电缆 ${r.cables} 测点 ${r.sensors} 巡测 ${r.inspections} 坏/断线点 ${r.invalid}`)
  console.log(`  网格内节点 ${r.insideNodes}，插值 NaN ${r.nanCount}，越界 ${r.outOfRange}`)
  for (const l of r.layers) {
    console.log(`  +${l.off}℃ 阈值=${l.threshold.toFixed(1)}：三角 ${l.triangles}，发热团 ${l.blobs}，数格体积 ${l.gridVol.toFixed(1)}m³，耗时 ${l.ms.toFixed(0)}ms`)
  }
  console.log(`  多层累计破洞边界边 ${r.boundary}（各层独立，期望 0）\n`)
}
console.log('冒烟完成')
