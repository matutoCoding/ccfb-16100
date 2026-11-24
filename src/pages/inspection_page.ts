// 巡测数据页：巡测记录列表、温度统计、CSV 导入导出
import type { Inspection } from '../types'
import { getState } from '../app/state'
import { inspectionRepo, sensorRepo } from '../core/repository'
import { clearEl, h, toast } from '../app/dom'

const statsOf = (insp: Inspection) => {
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let n = 0
  let bad = 0
  for (const v of insp.readings) {
    if (Number.isNaN(v)) {
      bad++
      continue
    }
    min = Math.min(min, v)
    max = Math.max(max, v)
    sum += v
    n++
  }
  return { min, max, avg: n ? sum / n : 0, bad, valid: n }
}

const exportCsv = (insp: Inspection, sensorCount: number) => {
  const rows = [['序号', '温度(℃)', '状态'].join(',')]
  for (let i = 0; i < sensorCount; i++) {
    const v = insp.readings[i]
    rows.push([String(i + 1), Number.isNaN(v) ? '' : v.toFixed(2), Number.isNaN(v) ? '坏点/断线' : '正常'].join(','))
  }
  const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${insp.warehouseId}-${insp.date}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// 解析按仓按缆按层导出的 CSV：接受单列温度（每行一个测点，顺序与传感器对齐）
const parseCsv = (text: string): Float32Array | null => {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return null
  const values: number[] = []
  // 跳过表头
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',')
    const tempCol = cols.find((c) => /^-?\d+(\.\d+)?$/.test(c.trim()))
    if (tempCol === undefined) continue
    values.push(Number(tempCol))
  }
  return values.length ? Float32Array.from(values) : null
}

export const renderInspectionPage = async (root: HTMLElement): Promise<void> => {
  clearEl(root)
  const state = getState()
  const w = state.warehouses.find((x) => x.id === state.currentWarehouseId)
  if (!w) {
    root.append(h('div', { class: 'empty-state card' }, h('div', { class: 'empty-title' }, '请先选择仓房')))
    return
  }
  const [inspections, sensors] = await Promise.all([
    inspectionRepo.byWarehouse(w.id),
    sensorRepo.byWarehouse(w.id),
  ])

  const fileInput = h('input', { type: 'file', accept: '.csv,text/csv', style: 'display:none' }) as HTMLInputElement
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    if (!file) return
    const text = await file.text()
    const readings = parseCsv(text)
    if (!readings || readings.length !== sensors.length) {
      toast(`导入失败：测点数 ${readings?.length ?? 0} 与档案 ${sensors.length} 不一致`)
      return
    }
    const date = new Date().toISOString().slice(0, 10)
    const insp: Inspection = {
      id: `${w.id}-insp-manual-${Date.now()}`,
      warehouseId: w.id,
      date,
      pointCount: sensors.length,
      readings,
      ambientTemp: inspections.at(-1)?.ambientTemp ?? 15,
      badPointIds: sensors.filter((_, i) => Number.isNaN(readings[i])).map((s) => s.id),
      createdAt: new Date().toISOString(),
    }
    await inspectionRepo.save(insp)
    toast('巡测数据已导入')
    renderInspectionPage(root)
  })

  const latest = inspections.at(-1)
  const latestStats = latest ? statsOf(latest) : null

  const summary = h('div', { class: 'grid-4 mb-4' },
    h('div', { class: 'card', style: 'text-align:center' }, h('div', { class: 'stat-value mono' }, String(inspections.length)), h('div', { class: 'stat-label' }, '巡测次数')),
    h('div', { class: 'card', style: 'text-align:center' }, h('div', { class: 'stat-value mono' }, latestStats ? latestStats.avg.toFixed(1) : '-'), h('div', { class: 'stat-label' }, '最新平均温 (℃)')),
    h('div', { class: 'card', style: 'text-align:center' }, h('div', { class: 'stat-value mono text-danger' }, latestStats ? latestStats.max.toFixed(1) : '-'), h('div', { class: 'stat-label' }, '最高温 (℃)')),
    h('div', { class: 'card', style: 'text-align:center' }, h('div', { class: 'stat-value mono text-warn' }, latestStats ? String(latestStats.bad) : '-'), h('div', { class: 'stat-label' }, '坏点/断线')),
  )

  const table = h('div', { class: 'table-wrap' },
    h('table', { class: 'data-table' },
      h('thead', {}, h('tr', {}, ...['巡测日期', '有效点', '坏点', '最低温', '最高温', '平均温', '环境温', '操作'].map((t) => h('th', {}, t)))),
      h('tbody', {},
        ...[...inspections].reverse().map((insp) => {
          const s = statsOf(insp)
          return h('tr', {},
            h('td', { class: 'mono' }, insp.date),
            h('td', { class: 'mono' }, String(s.valid)),
            h('td', {}, s.bad > 0 ? h('span', { class: 'tag tag-warn' }, String(s.bad)) : h('span', { class: 'tag tag-ok' }, '0')),
            h('td', { class: 'mono' }, s.min.toFixed(2)),
            h('td', { class: 'mono text-danger' }, s.max.toFixed(2)),
            h('td', { class: 'mono' }, s.avg.toFixed(2)),
            h('td', { class: 'mono' }, insp.ambientTemp.toFixed(1)),
            h('td', {}, h('button', { class: 'btn btn-sm', onClick: () => exportCsv(insp, sensors.length) }, '导出 CSV')),
          )
        }),
      ),
    ),
  )

  const empty = h('div', { class: 'empty-state' },
    h('div', { class: 'empty-title' }, '暂无巡测记录'),
    h('div', { class: 'empty-sub' }, '系统已为示范仓生成全年数据，或点击导入外部 CSV'),
  )

  root.append(
    h('div', { class: 'flex-between mb-4' },
      h('div', {}, h('h2', { class: 'page-title' }, `巡测数据 · ${w.name}`), h('p', { class: 'page-sub', style: 'margin:0' }, '每 3 天一次，坏点读数为 NaN，插值自动跳过')),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary', onClick: () => fileInput.click() }, '导入 CSV'),
        fileInput,
      ),
    ),
    summary,
    h('div', { class: 'card' }, inspections.length === 0 ? empty : table),
  )
}
