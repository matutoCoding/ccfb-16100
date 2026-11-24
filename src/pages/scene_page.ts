// 三维粮情页：时间轴、多层半透明等值面、电缆测点、历史曲线、剖面等温线
import type { HeatBlob, Inspection, SensorPoint } from '../types'
import { getState } from '../app/state'
import { cableRepo, inspectionRepo, sensorRepo } from '../core/repository'
import { clearEl, h, modal, toast } from '../app/dom'
import { GrainRenderer } from '../webgl/renderer'
import { attachOrbitControls } from '../webgl/orbit'
import { buildCableLines, buildSensorPoints, buildSurfaceLines, buildWallLines } from '../webgl/scene_geo'
import { buildGridSpec } from '../core/grid'
import { workerExtract, workerInterpolate } from '../core/worker_client'
import { warehouseBounds } from '../core/geometry'
import { drawHistoryCurve, drawIsothermSlice } from './charts'
import { exportInspectionReport } from '../app/report'

const ISO_COLORS: [number, number, number, number][] = [
  [0.91, 0.36, 0.24, 0.32],
  [0.93, 0.55, 0.18, 0.4],
  [0.83, 0.2, 0.24, 0.5],
]

export const renderScenePage = async (root: HTMLElement): Promise<void> => {
  clearEl(root)
  const state = getState()
  const w = state.warehouses.find((x) => x.id === state.currentWarehouseId)
  if (!w) {
    root.append(h('div', { class: 'empty-state card' }, h('div', { class: 'empty-title' }, '请先选择仓房')))
    return
  }
  const [cables, sensors, inspections] = await Promise.all([
    cableRepo.byWarehouse(w.id),
    sensorRepo.byWarehouse(w.id),
    inspectionRepo.byWarehouse(w.id),
  ])
  if (inspections.length === 0) {
    root.append(h('div', { class: 'empty-state card' }, h('div', { class: 'empty-title' }, '暂无巡测数据')))
    return
  }

  let timeIndex = inspections.length - 1
  let renderer: GrainRenderer | null = null
  let fieldCache: ReturnType<typeof Object> | null = null
  let showCables = true
  let showSurface = true
  let playTimer: number | null = null
  let latestBlobs: HeatBlob[] = []
  let latestSliceCanvas: HTMLCanvasElement | null = null

  const canvas = h('canvas', { style: 'width:100%;height:100%;display:block;border-radius:var(--radius-lg)' }) as HTMLCanvasElement
  const infoBox = h('div', { class: 'card', style: 'position:absolute;left:16px;top:16px;min-width:200px;background:rgba(255,255,255,0.92)' })
  const sliceBox = h('div', { class: 'card', style: 'position:absolute;right:16px;top:16px;width:280px;background:rgba(255,255,255,0.92)' })
  const canvasHost = h('div', { style: 'position:relative;height:calc(100vh - 220px);min-height:420px;background:var(--c-surface-2);border-radius:var(--radius-lg);border:1px solid var(--c-border);overflow:hidden' }, canvas, infoBox, sliceBox)

  const dateLabel = h('span', { class: 'mono fw-semibold' }, inspections[timeIndex].date)
  const statusLabel = h('span', { class: 'tag tag-primary' }, '就绪')
  const blobList = h('div', { style: 'margin-top:8px;display:flex;flex-direction:column;gap:6px' })

  const buildInvalid = (insp: Inspection): Uint8Array => {
    const invalid = new Uint8Array(sensors.length)
    for (let i = 0; i < sensors.length; i++) {
      if (Number.isNaN(insp.readings[i]) || sensors[i].status !== 'ok') invalid[i] = 1
    }
    return invalid
  }

  const updateInfo = (insp: Inspection, blobs: HeatBlob[]) => {
    clearEl(infoBox)
    const s = insp.readings.reduce(
      (acc, v) => (Number.isNaN(v) ? acc : { min: Math.min(acc.min, v), max: Math.max(acc.max, v), sum: acc.sum + v, n: acc.n + 1 }),
      { min: Infinity, max: -Infinity, sum: 0, n: 0 },
    )
    infoBox.append(
      h('div', { class: 'card-title', style: 'margin:0' }, '当前粮情'),
      h('div', { class: 'muted mt-4' }, `日期 `, dateLabel),
      h('div', { class: 'mono mt-4' }, `均温 ${(s.sum / s.n).toFixed(2)}℃　最高 ${s.max.toFixed(2)}℃`),
      h('div', { class: 'mono' }, `发热团 ${blobs.length} 个`),
      blobList,
    )
    clearEl(blobList)
    for (const b of blobs.slice(0, 6)) {
      blobList.append(
        h('div', { class: 'flex-between', style: 'font-size:var(--fs-xs)' },
          h('span', { class: 'tag tag-danger' }, `#${b.trackId}`),
          h('span', { class: 'mono' }, `${b.maxTemp.toFixed(1)}℃ / ${b.volume.toFixed(1)}m³`),
        ),
      )
    }
  }

  // 主计算流程：插值（缓存）+ 多层抽取
  const runExtraction = async (insp: Inspection) => {
    statusLabel.textContent = '计算中'
    statusLabel.className = 'tag tag-warn'
    try {
      const resolution = state.settings.gridResolution
      const spec = buildGridSpec(w, resolution)
      if (!fieldCache || (fieldCache as { key?: string }).key !== `${insp.id}-${resolution}`) {
        const invalid = buildInvalid(insp)
        const { field } = await workerInterpolate(w, sensors, insp.readings, invalid, resolution)
        fieldCache = Object.assign(field, { key: `${insp.id}-${resolution}` })
      }
      const field = fieldCache as unknown as Parameters<typeof workerExtract>[0]
      renderer?.clearIsoLayers()
      const allBlobs: HeatBlob[] = []
      const baseTemp = insp.readings.reduce((a, v) => (Number.isNaN(v) ? a : Math.min(a, v)), Infinity)
      for (let layer = 0; layer < state.settings.isoOffsets.length; layer++) {
        const threshold = baseTemp + state.settings.isoOffsets[layer]
        const { result } = await workerExtract(field, threshold, layer === 0)
        renderer?.setIsoMesh(result.mesh, ISO_COLORS[layer] ?? ISO_COLORS[0])
        if (layer === 0) {
          // 仅第一层做团标记，避免重复
          for (const b of result.blobs) {
            allBlobs.push({
              id: `${insp.id}-b${layer}-${b.cx.toFixed(1)}`,
              warehouseId: w.id,
              trackId: allBlobs.length + 1,
              inspectionId: insp.id,
              date: insp.date,
              threshold,
              voxelCount: b.cellCount,
              volume: b.volume,
              gridVolume: b.gridVolume,
              maxTemp: b.maxTemp,
              centerX: b.cx,
              centerY: b.cy,
              centerZ: b.cz,
              growthRate: 0,
            })
          }
        }
      }
      latestBlobs = allBlobs
      updateInfo(insp, allBlobs)
      renderer?.render()
      statusLabel.textContent = '就绪'
      statusLabel.className = 'tag tag-ok'
    } catch (err) {
      statusLabel.textContent = '失败'
      statusLabel.className = 'tag tag-danger'
      toast(err instanceof Error ? err.message : '抽取失败')
    }
  }

  // 初始化渲染器
  const initRenderer = () => {
    renderer = new GrainRenderer(canvas, warehouseBounds(w))
    renderer.resize(canvas.clientWidth, canvas.clientHeight)
    renderer.setLines(buildWallLines(w), [0.45, 0.5, 0.58, 0.9])
    if (showCables) renderer.setLines(buildCableLines(cables, sensors), [0.25, 0.55, 0.32, 0.85])
    if (showSurface) {
      const spec = buildGridSpec(w, 48)
      renderer.setLines(buildSurfaceLines(w, spec), [0.6, 0.5, 0.35, 0.7])
    }
    renderer.setPoints(buildSensorPoints(sensors.filter((s) => s.status !== 'ok')), [0.6, 0.62, 0.68, 1])
    const detach = attachOrbitControls(canvas, renderer.camera, () => renderer?.render())
    const ro = new ResizeObserver(() => {
      renderer?.resize(canvas.clientWidth, canvas.clientHeight)
      renderer?.render()
    })
    ro.observe(canvas)
    return () => {
      detach()
      ro.disconnect()
      renderer?.dispose()
    }
  }

  const slider = h('input', {
    type: 'range', min: 0, max: inspections.length - 1, value: String(timeIndex),
    style: 'flex:1',
  }) as HTMLInputElement
  slider.addEventListener('input', () => {
    timeIndex = Number(slider.value)
    dateLabel.textContent = inspections[timeIndex].date
    void runExtraction(inspections[timeIndex])
  })

  const playBtn = h('button', { class: 'btn btn-sm' }, '播放')
  playBtn.addEventListener('click', () => {
    if (playTimer !== null) {
      clearInterval(playTimer)
      playTimer = null
      playBtn.textContent = '播放'
      return
    }
    playBtn.textContent = '暂停'
    playTimer = window.setInterval(() => {
      timeIndex = (timeIndex + 1) % inspections.length
      slider.value = String(timeIndex)
      dateLabel.textContent = inspections[timeIndex].date
      void runExtraction(inspections[timeIndex])
    }, 1000 / state.settings.playbackFps)
  })

  const cableToggle = h('button', { class: 'btn btn-sm btn-primary' }, '隐藏电缆')
  cableToggle.addEventListener('click', () => {
    showCables = !showCables
    cableToggle.textContent = showCables ? '隐藏电缆' : '显示电缆'
    initRenderer()
    void runExtraction(inspections[timeIndex])
  })

  // 剖面等温线
  const sliceAxis = h('select', { class: 'select', style: 'height:30px;font-size:var(--fs-xs)' },
    h('option', { value: 'z' }, '水平剖面 (z)'),
    h('option', { value: 'x' }, '纵向 x'),
    h('option', { value: 'y' }, '纵向 y'),
  ) as HTMLSelectElement
  const slicePos = h('input', { type: 'range', min: 0, max: 100, value: 50, style: 'width:100%' }) as HTMLInputElement
  const sliceCanvas = h('canvas', { width: 260, height: 200, style: 'width:100%;background:var(--c-surface-2);border-radius:var(--radius);border:1px solid var(--c-border)' }) as HTMLCanvasElement
  latestSliceCanvas = sliceCanvas
  const drawSlice = async () => {
    if (!fieldCache) return
    const insp = inspections[timeIndex]
    await drawIsothermSlice(
      sliceCanvas,
      fieldCache as unknown as Parameters<typeof drawIsothermSlice>[1],
      w,
      sliceAxis.value as 'x' | 'y' | 'z',
      Number(slicePos.value) / 100,
      state.settings.isoOffsets.map((o) => insp.readings.reduce((a, v) => (Number.isNaN(v) ? a : Math.min(a, v)), Infinity) + o),
    )
  }
  sliceAxis.addEventListener('change', drawSlice)
  slicePos.addEventListener('input', drawSlice)

  // 双击拾取最近测点：用相机参数把测点投影到屏幕，选距离点击位置最近的
  const showHistoryModal = (sensor: SensorPoint) => {
    const curveCanvas = h('canvas', { width: 520, height: 280, style: 'width:100%' }) as HTMLCanvasElement
    const idx = sensors.findIndex((s) => s.id === sensor.id)
    const series = inspections.map((insp) => ({ date: insp.date, value: insp.readings[idx] }))
    const content = h('div', {},
      h('div', { class: 'muted mb-4' }, `测点 ${sensor.id}（${sensor.x.toFixed(1)}, ${sensor.y.toFixed(1)}, ${sensor.z.toFixed(1)}）`),
      curveCanvas,
    )
    modal(content, '测点历史温度曲线')
    setTimeout(() => drawHistoryCurve(curveCanvas, series), 0)
  }

  canvas.addEventListener('dblclick', (ev) => {
    if (!renderer) return
    const rect = canvas.getBoundingClientRect()
    const px = ((ev.clientX - rect.left) / rect.width) * 2 - 1
    const py = -(((ev.clientY - rect.top) / rect.height) * 2 - 1)
    // 简化拾取：把每个测点经相机视图投影，取屏幕距离最近且在阈值内的
    const cam = renderer.camera
    const cp = Math.cos(cam.pitch)
    const eye = [
      cam.target[0] + cam.distance * cp * Math.cos(cam.yaw),
      cam.target[1] + cam.distance * cp * Math.sin(cam.yaw),
      cam.target[2] + cam.distance * Math.sin(cam.pitch),
    ]
    let best: SensorPoint | null = null
    let bestScore = 0.08
    for (const s of sensors) {
      // 相对相机的近似屏幕投影（忽略透视，用正交化分量）
      const dx = s.x - eye[0]
      const dy = s.y - eye[1]
      const dz = s.z - eye[2]
      const rightX = -Math.sin(cam.yaw)
      const rightY = Math.cos(cam.yaw)
      const sx = dx * rightX + dy * rightY
      const sy = dx * (-cp * Math.cos(cam.yaw)) + dy * (-cp * Math.sin(cam.yaw)) + dz * Math.sin(cam.pitch)
      const depth = dx * cp * Math.cos(cam.yaw) + dy * cp * Math.sin(cam.yaw) + dz * Math.cos(cam.pitch)
      if (depth <= 0) continue
      const score = Math.hypot(sx / cam.distance - px * 0.5, sy / cam.distance - py * 0.5)
      if (score < bestScore) {
        bestScore = score
        best = s
      }
    }
    if (best) showHistoryModal(best)
    else toast('未命中测点，请双击靠近某个测点')
  })

  sliceBox.append(
    h('div', { class: 'card-title', style: 'margin:0 0 8px' }, '剖面等温线'),
    sliceAxis,
    h('div', { class: 'mt-4' }, slicePos),
    h('div', { class: 'mt-4' }, sliceCanvas),
    h('div', { class: 'dim mt-4', style: 'font-size:12px' }, '拖动滑块切换剖面位置'),
  )

  const reportBtn = h('button', {
    class: 'btn btn-sm',
    onClick: () => {
      if (!renderer) return
      exportInspectionReport({
        warehouse: w,
        inspection: inspections[timeIndex],
        blobs: latestBlobs,
        renderer,
        sliceCanvas: latestSliceCanvas,
      })
      toast('巡仓报告已生成并下载')
    },
  }, '导出巡仓报告')

  root.append(
    h('div', { class: 'flex-between mb-4' },
      h('div', {}, h('h2', { class: 'page-title' }, `三维粮情 · ${w.name}`), h('p', { class: 'page-sub', style: 'margin:0' }, '双击测点查看历史曲线，左键旋转 / 右键平移 / 滚轮缩放')),
      h('div', { class: 'btn-row' }, statusLabel, cableToggle, playBtn, reportBtn),
    ),
    canvasHost,
    h('div', { class: 'card mt-4' },
      h('div', { class: 'flex-between' },
        h('span', {}, '巡测时间轴 ', dateLabel),
        h('span', { class: 'dim' }, `${inspections.length} 次巡测`),
      ),
      h('div', { class: 'flex gap-3 mt-4' }, slider),
    ),
  )

  // 启动
  setTimeout(() => {
    initRenderer()
    void runExtraction(inspections[timeIndex])
    setTimeout(drawSlice, 300)
  }, 0)
}
