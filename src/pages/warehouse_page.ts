// 仓房档案页：仓房列表、新建/编辑、粮面实测控制点
import type { GrainType, SurfacePoint, Warehouse, WarehouseType } from '../types'
import { GRAIN_LABEL } from '../types'
import { warehouseRepo } from '../core/repository'
import { getState, refreshWarehouses, setCurrentWarehouse } from '../app/state'
import { clearEl, h, modal, toast } from '../app/dom'
import { surfaceHeight, warehouseBounds } from '../core/geometry'
import { newWarehouseId } from '../core/seed'

const grainOptions: GrainType[] = ['wheat', 'corn', 'paddy', 'soybean', 'rapeseed']

const fieldInput = (label: string, input: HTMLElement): HTMLElement =>
  h('div', { class: 'field' }, h('label', {}, label), input)

const statCard = (value: string, label: string): HTMLElement =>
  h('div', { class: 'card', style: 'text-align:center' }, h('div', { class: 'stat-value mono' }, value), h('div', { class: 'stat-label' }, label))

const warehouseForm = (existing: Warehouse | null, onDone: () => void): HTMLElement => {
  const w: Warehouse = existing ?? {
    id: newWarehouseId(),
    name: '',
    type: 'rect',
    length: 30,
    width: 18,
    diameter: 20,
    wallHeight: 8,
    fillLine: 6,
    grainType: 'wheat',
    inboundDate: new Date().toISOString().slice(0, 10),
    moisture: 13,
    bulkDensity: 760,
    surfacePoints: [],
    createdAt: new Date().toISOString(),
  }

  const nameInput = h('input', { class: 'input', value: w.name, placeholder: '如 3号平房仓' }) as HTMLInputElement
  const typeSelect = h('select', { class: 'select' },
    h('option', { value: 'rect' }, '平房仓'),
    h('option', { value: 'silo' }, '浅圆仓'),
  ) as HTMLSelectElement
  typeSelect.value = w.type
  const lengthInput = h('input', { class: 'input', type: 'number', value: String(w.length) }) as HTMLInputElement
  const widthInput = h('input', { class: 'input', type: 'number', value: String(w.width) }) as HTMLInputElement
  const diameterInput = h('input', { class: 'input', type: 'number', value: String(w.diameter) }) as HTMLInputElement
  const wallInput = h('input', { class: 'input', type: 'number', value: String(w.wallHeight) }) as HTMLInputElement
  const fillInput = h('input', { class: 'input', type: 'number', step: '0.1', value: String(w.fillLine) }) as HTMLInputElement
  const grainSelect = h('select', { class: 'select' },
    ...grainOptions.map((g) => h('option', { value: g }, GRAIN_LABEL[g])),
  ) as HTMLSelectElement
  grainSelect.value = w.grainType
  const dateInput = h('input', { class: 'input', type: 'date', value: w.inboundDate }) as HTMLInputElement
  const moistureInput = h('input', { class: 'input', type: 'number', step: '0.1', value: String(w.moisture) }) as HTMLInputElement
  const densityInput = h('input', { class: 'input', type: 'number', value: String(w.bulkDensity) }) as HTMLInputElement
  const pointsText = h('textarea', {
    class: 'input',
    rows: 5,
    placeholder: '每行 x,y,z（米），留空则按装粮线平粮面',
  }) as HTMLTextAreaElement
  pointsText.value = w.surfacePoints.map((p) => `${p.x},${p.y},${p.z}`).join('\n')

  const typeDependent = h('div', { class: 'grid-2' },
    fieldInput('长 (m)', lengthInput),
    fieldInput('宽 (m)', widthInput),
  )
  const siloDependent = fieldInput('直径 (m)', diameterInput)
  const refreshTypeFields = () => {
    if (typeSelect.value === 'rect') {
      typeDependent.style.display = ''
      siloDependent.style.display = 'none'
    } else {
      typeDependent.style.display = 'none'
      siloDependent.style.display = ''
    }
  }
  typeSelect.addEventListener('change', refreshTypeFields)
  refreshTypeFields()

  const save = async () => {
    if (!nameInput.value.trim()) {
      toast('请填写仓房名称')
      return
    }
    const surfacePoints: SurfacePoint[] = pointsText.value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [x, y, z] = line.split(/[,，\s]+/).map(Number)
        return { x, y, z }
      })
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))

    const next: Warehouse = {
      ...w,
      name: nameInput.value.trim(),
      type: typeSelect.value as WarehouseType,
      length: Number(lengthInput.value),
      width: Number(widthInput.value),
      diameter: Number(diameterInput.value),
      wallHeight: Number(wallInput.value),
      fillLine: Number(fillInput.value),
      grainType: grainSelect.value as GrainType,
      inboundDate: dateInput.value,
      moisture: Number(moistureInput.value),
      bulkDensity: Number(densityInput.value),
      surfacePoints,
    }
    await warehouseRepo.save(next)
    await refreshWarehouses()
    toast(existing ? '档案已更新' : '仓房已建档')
    onDone()
  }

  return h('div', {},
    h('div', { class: 'grid-2' },
      fieldInput('仓房名称', nameInput),
      fieldInput('仓型', typeSelect),
    ),
    typeDependent,
    siloDependent,
    h('div', { class: 'grid-3' },
      fieldInput('檐墙高 (m)', wallInput),
      fieldInput('装粮线 (m)', fillInput),
      fieldInput('入仓日期', dateInput),
    ),
    h('div', { class: 'grid-3' },
      fieldInput('粮种', grainSelect),
      fieldInput('水分 (%)', moistureInput),
      fieldInput('容重 (kg/m³)', densityInput),
    ),
    fieldInput('粮面实测控制点', pointsText),
    h('div', { class: 'btn-row mt-4' },
      h('button', { class: 'btn btn-primary', onClick: save }, '保存档案'),
      h('button', { class: 'btn', onClick: onDone }, '取消'),
    ),
  )
}

export const renderWarehousePage = (root: HTMLElement): void => {
  const state = getState()
  clearEl(root)
  const list = state.warehouses

  const openForm = (w: Warehouse | null) => {
    const close = modal(warehouseForm(w, () => close()), w ? '编辑仓房档案' : '新建仓房档案')
  }

  const totalGrain = list.reduce((sum, w) => {
    const b = warehouseBounds(w)
    const top = surfaceHeight(w, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2)
    const area = w.type === 'rect' ? w.length * w.width : Math.PI * (w.diameter / 2) ** 2
    return sum + (area * top * w.bulkDensity) / 1000
  }, 0)

  const stats = h('div', { class: 'grid-4 mb-4' },
    statCard(String(list.length), '在档仓房'),
    statCard(String(list.filter((x) => x.type === 'rect').length), '平房仓'),
    statCard(String(list.filter((x) => x.type === 'silo').length), '浅圆仓'),
    statCard(`${totalGrain.toFixed(0)} 吨`, '估算总储量'),
  )

  const table = h('div', { class: 'table-wrap' },
    h('table', { class: 'data-table' },
      h('thead', {}, h('tr', {},
        ...['名称', '仓型', '尺寸 (m)', '装粮线', '粮种', '水分', '入仓时间', '粮面控制点', '操作'].map((t) => h('th', {}, t)),
      )),
      h('tbody', {},
        ...list.map((w) =>
          h('tr', {},
            h('td', { class: 'fw-medium' }, w.name),
            h('td', {}, h('span', { class: 'tag tag-primary' }, w.type === 'rect' ? '平房仓' : '浅圆仓')),
            h('td', { class: 'mono' }, w.type === 'rect' ? `${w.length}×${w.width}` : `Φ${w.diameter}`),
            h('td', { class: 'mono' }, `${w.fillLine}m`),
            h('td', {}, GRAIN_LABEL[w.grainType]),
            h('td', { class: 'mono' }, `${w.moisture}%`),
            h('td', {}, w.inboundDate),
            h('td', { class: 'mono' }, String(w.surfacePoints.length)),
            h('td', {},
              h('div', { class: 'btn-row' },
                h('button', { class: 'btn btn-sm', onClick: () => setCurrentWarehouse(w.id) }, '选中'),
                h('button', { class: 'btn btn-sm', onClick: () => openForm(w) }, '编辑'),
                h('button', {
                  class: 'btn btn-sm btn-danger',
                  onClick: async () => {
                    if (!confirm(`确认删除 ${w.name}？关联电缆、巡测、隐患记录将一并清除`)) return
                    await warehouseRepo.remove(w.id)
                    await refreshWarehouses()
                    toast('仓房已删除')
                  },
                }, '删除'),
              ),
            ),
          ),
        ),
      ),
    ),
  )

  const empty = h('div', { class: 'empty-state card' },
    h('div', { class: 'empty-icon' }, h('span', { style: 'font-size:28px' }, '▦')),
    h('div', { class: 'empty-title' }, '还没有仓房档案'),
    h('div', { class: 'empty-sub' }, '点击右上角按钮，按实际尺寸和装粮线建立第一个仓房'),
  )

  root.append(
    h('div', { class: 'flex-between mb-4' },
      h('div', {},
        h('h2', { class: 'page-title' }, '仓房档案'),
        h('p', { class: 'page-sub', style: 'margin:0' }, '按仓型建档，粮面高程由实测控制点 IDW 拟合'),
      ),
      h('button', { class: 'btn btn-primary', onClick: () => openForm(null) }, '新建仓房'),
    ),
    stats,
    h('div', { class: 'card' }, list.length === 0 ? empty : table),
  )
}
