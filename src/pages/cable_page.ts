// 电缆布置页：电缆列表、测点统计、坏点/断线标记、布置示意
import { getState } from '../app/state'
import { cableRepo, sensorRepo } from '../core/repository'
import { clearEl, h, toast } from '../app/dom'

const statusTag = (status: string): HTMLElement => {
  if (status === 'bad') return h('span', { class: 'tag tag-warn' }, '坏点')
  if (status === 'offline') return h('span', { class: 'tag tag-danger' }, '断线')
  return h('span', { class: 'tag tag-ok' }, '正常')
}

export const renderCablePage = async (root: HTMLElement): Promise<void> => {
  clearEl(root)
  const state = getState()
  const w = state.warehouses.find((x) => x.id === state.currentWarehouseId)
  if (!w) {
    root.append(h('div', { class: 'empty-state card' }, h('div', { class: 'empty-title' }, '请先选择仓房')))
    return
  }
  const [cables, sensors] = await Promise.all([
    cableRepo.byWarehouse(w.id),
    sensorRepo.byWarehouse(w.id),
  ])

  const offlineCables = cables.filter((c) => c.status === 'offline').length
  const badSensors = sensors.filter((s) => s.status === 'bad').length
  const offlineSensors = sensors.filter((s) => s.status === 'offline').length
  const totalPoints = sensors.length

  const stats = h('div', { class: 'grid-4 mb-4' },
    h('div', { class: 'card', style: 'text-align:center' }, h('div', { class: 'stat-value mono' }, String(cables.length)), h('div', { class: 'stat-label' }, '测温电缆')),
    h('div', { class: 'card', style: 'text-align:center' }, h('div', { class: 'stat-value mono' }, String(totalPoints)), h('div', { class: 'stat-label' }, '测温点总数')),
    h('div', { class: 'card', style: 'text-align:center' }, h('div', { class: 'stat-value mono text-warn' }, String(badSensors)), h('div', { class: 'stat-label' }, '坏点（插值跳过）')),
    h('div', { class: 'card', style: 'text-align:center' }, h('div', { class: 'stat-value mono text-danger' }, String(offlineCables)), h('div', { class: 'stat-label' }, `断线电缆（${offlineSensors} 点）`)),
  )

  // 布置示意（俯视，按比例散点）
  const canvas = h('canvas', { width: 560, height: 420, style: 'width:100%;background:var(--c-surface-2);border-radius:var(--radius);border:1px solid var(--c-border)' }) as HTMLCanvasElement
  const drawLayout = () => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const pad = 40
    const isRect = w.type === 'rect'
    const scale = isRect
      ? Math.min((canvas.width - pad * 2) / w.length, (canvas.height - pad * 2) / w.width)
      : Math.min(canvas.width, canvas.height - pad) / w.diameter
    const toX = (x: number) => isRect ? pad + x * scale : canvas.width / 2 + x * scale
    const toY = (y: number) => isRect ? pad + y * scale : canvas.height / 2 + y * scale

    ctx.strokeStyle = '#94a3b8'
    ctx.lineWidth = 1.5
    if (isRect) {
      ctx.strokeRect(pad, pad, w.length * scale, w.width * scale)
    } else {
      ctx.beginPath()
      ctx.arc(canvas.width / 2, canvas.height / 2, (w.diameter / 2) * scale, 0, Math.PI * 2)
      ctx.stroke()
    }
    for (const c of cables) {
      const cx = toX(c.x)
      const cy = toY(c.y)
      ctx.beginPath()
      ctx.arc(cx, cy, c.status === 'offline' ? 5 : 3.5, 0, Math.PI * 2)
      ctx.fillStyle = c.status === 'offline' ? '#dc2626' : '#2563eb'
      ctx.fill()
    }
    ctx.fillStyle = '#64748b'
    ctx.font = '12px sans-serif'
    ctx.fillText(isRect ? '俯视：蓝点=正常电缆，红点=断线' : '同心圈布置俯视', pad, 20)
  }
  setTimeout(drawLayout, 0)

  // 电缆明细表
  const table = h('div', { class: 'table-wrap' },
    h('table', { class: 'data-table' },
      h('thead', {}, h('tr', {}, ...['编号', '圈号', 'X (m)', 'Y (m)', '测温点数', '点间距', '首点深度', '状态'].map((t) => h('th', {}, t)))),
      h('tbody', {},
        ...cables.slice(0, 200).map((c) =>
          h('tr', {},
            h('td', { class: 'mono' }, c.code),
            h('td', { class: 'mono' }, c.ring === 0 ? (w.type === 'silo' ? '中心' : '-') : String(c.ring)),
            h('td', { class: 'mono' }, c.x.toFixed(2)),
            h('td', { class: 'mono' }, c.y.toFixed(2)),
            h('td', { class: 'mono' }, String(c.pointCount)),
            h('td', { class: 'mono' }, `${c.spacing}m`),
            h('td', { class: 'mono' }, `${c.firstDepth}m`),
            h('td', {}, statusTag(c.status)),
          ),
        ),
      ),
    ),
  )

  const regen = h('button', {
    class: 'btn',
    onClick: () => toast('电缆由仓房尺寸自动布置，修改仓房档案后重建'),
  }, '布置规则说明')

  root.append(
    h('div', { class: 'flex-between mb-4' },
      h('div', {}, h('h2', { class: 'page-title' }, `电缆布置 · ${w.name}`), h('p', { class: 'page-sub', style: 'margin:0' }, w.type === 'rect' ? '行列网格布置，点数随粮面高程变化' : '同心圈布置，中心 1 根 + 各圈均布')),
      regen,
    ),
    stats,
    h('div', { class: 'grid-2' },
      h('div', { class: 'card' }, h('div', { class: 'card-title' }, '布置俯视图'), canvas),
      h('div', { class: 'card' }, h('div', { class: 'card-title' }, '状态说明'),
        h('div', { class: 'flex gap-3 mt-4' }, h('span', { class: 'tag tag-ok' }, '正常'), h('span', { class: 'muted' }, '参与三维插值')),
        h('div', { class: 'flex gap-3 mt-4' }, h('span', { class: 'tag tag-warn' }, '坏点'), h('span', { class: 'muted' }, '读数 NaN，插值时跳过，不当 0 度')),
        h('div', { class: 'flex gap-3 mt-4' }, h('span', { class: 'tag tag-danger' }, '断线'), h('span', { class: 'muted' }, '整缆离线，全部测点剔除')),
      ),
    ),
    h('div', { class: 'card mt-4' }, h('div', { class: 'card-title' }, `电缆明细（前 200 条，共 ${cables.length} 条）`), table),
  )
}
