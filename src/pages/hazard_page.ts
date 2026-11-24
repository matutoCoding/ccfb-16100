// 隐患处置页：发热团隐患登记、处置措施、措施前后体积/温度对比
import type { HazardCase, Treatment, TreatmentType } from '../types'
import { TREATMENT_LABEL } from '../types'
import { getState } from '../app/state'
import { blobRepo, hazardRepo } from '../core/repository'
import { clearEl, h, modal, toast } from '../app/dom'

const levelTag = (level: HazardCase['level']) => {
  const map = { watch: ['tag', '关注'], warning: ['tag tag-warn', '警告'], serious: ['tag tag-danger', '严重'] } as const
  const [cls, label] = map[level]
  return h('span', { class: cls }, label)
}

const statusTag = (status: HazardCase['status']) => {
  const map = { open: ['tag tag-danger', '待处置'], treating: ['tag tag-warn', '处置中'], closed: ['tag tag-ok', '已闭环'] } as const
  const [cls, label] = map[status]
  return h('span', { class: cls }, label)
}

const treatmentForm = (onSave: (t: Omit<Treatment, 'id'>) => void): HTMLElement => {
  const typeSelect = h('select', { class: 'select' },
    ...(Object.keys(TREATMENT_LABEL) as TreatmentType[]).map((k) => h('option', { value: k }, TREATMENT_LABEL[k])),
  ) as HTMLSelectElement
  const dateInput = h('input', { class: 'input', type: 'date', value: new Date().toISOString().slice(0, 10) }) as HTMLInputElement
  const durationInput = h('input', { class: 'input', type: 'number', value: '24' }) as HTMLInputElement
  const beforeVol = h('input', { class: 'input', type: 'number', step: '0.1', placeholder: '处置前体积 m³' }) as HTMLInputElement
  const afterVol = h('input', { class: 'input', type: 'number', step: '0.1', placeholder: '处置后体积 m³' }) as HTMLInputElement
  const beforeTemp = h('input', { class: 'input', type: 'number', step: '0.1', placeholder: '处置前最高温 ℃' }) as HTMLInputElement
  const afterTemp = h('input', { class: 'input', type: 'number', step: '0.1', placeholder: '处置后最高温 ℃' }) as HTMLInputElement
  const noteInput = h('textarea', { class: 'input', rows: 2, placeholder: '处置备注' }) as HTMLTextAreaElement

  const field = (label: string, input: HTMLElement) => h('div', { class: 'field' }, h('label', {}, label), input)

  return h('div', {},
    h('div', { class: 'grid-2' }, field('措施类型', typeSelect), field('实施日期', dateInput)),
    h('div', { class: 'grid-2 mt-4' }, field('持续时长 (h)', durationInput), field('备注', noteInput)),
    h('div', { class: 'grid-2 mt-4' }, field('处置前体积', beforeVol), field('处置后体积', afterVol)),
    h('div', { class: 'grid-2 mt-4' }, field('处置前最高温', beforeTemp), field('处置后最高温', afterTemp)),
    h('div', { class: 'btn-row mt-4' },
      h('button', {
        class: 'btn btn-primary',
        onClick: () => {
          onSave({
            type: typeSelect.value as TreatmentType,
            date: dateInput.value,
            durationHours: Number(durationInput.value),
            note: noteInput.value,
            beforeVolume: Number(beforeVol.value) || 0,
            afterVolume: Number(afterVol.value) || 0,
            beforeMaxTemp: Number(beforeTemp.value) || 0,
            afterMaxTemp: Number(afterTemp.value) || 0,
          })
        },
      }, '保存措施'),
    ),
  )
}

export const renderHazardPage = async (root: HTMLElement): Promise<void> => {
  clearEl(root)
  const state = getState()
  const w = state.warehouses.find((x) => x.id === state.currentWarehouseId)
  if (!w) {
    root.append(h('div', { class: 'empty-state card' }, h('div', { class: 'empty-title' }, '请先选择仓房')))
    return
  }
  const [hazards, blobs] = await Promise.all([
    hazardRepo.byWarehouse(w.id),
    blobRepo.byWarehouse(w.id),
  ])
  const latestBlobs = blobs.filter((b) => b.date === blobs.at(-1)?.date)

  const newHazard = () => {
    const titleInput = h('input', { class: 'input', placeholder: '如 中下层发热团 #1' }) as HTMLInputElement
    const levelSelect = h('select', { class: 'select' },
      h('option', { value: 'watch' }, '关注'),
      h('option', { value: 'warning' }, '警告'),
      h('option', { value: 'serious' }, '严重'),
    ) as HTMLSelectElement
    const trackInput = h('input', { class: 'input', type: 'number', value: '1' }) as HTMLInputElement
    const noteInput = h('textarea', { class: 'input', rows: 3 }) as HTMLTextAreaElement
    const content = h('div', {},
      h('div', { class: 'field' }, h('label', {}, '隐患标题'), titleInput),
      h('div', { class: 'grid-2 mt-4' },
        h('div', { class: 'field' }, h('label', {}, '发热团编号'), trackInput),
        h('div', { class: 'field' }, h('label', {}, '等级'), levelSelect),
      ),
      h('div', { class: 'field mt-4' }, h('label', {}, '说明'), noteInput),
    )
    const close = modal(content, '登记隐患')
    const saveBtn = h('button', {
      class: 'btn btn-primary',
      onClick: async () => {
        const hazard: HazardCase = {
          id: `hz-${Date.now()}`,
          warehouseId: w.id,
          trackId: Number(trackInput.value),
          title: titleInput.value || '未命名隐患',
          foundDate: new Date().toISOString().slice(0, 10),
          status: 'open',
          level: levelSelect.value as HazardCase['level'],
          treatments: [],
          note: noteInput.value,
        }
        await hazardRepo.save(hazard)
        close()
        toast('隐患已登记')
        renderHazardPage(root)
      },
    }, '保存')
    content.append(h('div', { class: 'btn-row mt-4' }, saveBtn))
  }

  const addTreatment = (hz: HazardCase) => {
    const close = modal(treatmentForm((t) => {
      hz.treatments.push({ ...t, id: `tr-${Date.now()}` })
      hz.status = hz.treatments.some((x) => x.afterVolume < x.beforeVolume) ? 'closed' : 'treating'
      void hazardRepo.save(hz).then(() => {
        close()
        toast('处置措施已记录')
        renderHazardPage(root)
      })
    }), `记录处置 · ${hz.title}`)
  }

  const cards = hazards.length === 0
    ? h('div', { class: 'empty-state' },
      h('div', { class: 'empty-icon' }, h('span', { style: 'font-size:28px' }, '◉')),
      h('div', { class: 'empty-title' }, '暂无隐患记录'),
      h('div', { class: 'empty-sub' }, '三维粮情页识别发热团后，在此登记并跟踪处置'),
    )
    : h('div', { class: 'grid-2' }, ...hazards.map((hz) => {
      const last = hz.treatments.at(-1)
      const volChange = last ? ((last.afterVolume - last.beforeVolume) / Math.max(0.1, last.beforeVolume)) * 100 : 0
      return h('div', { class: 'card' },
        h('div', { class: 'flex-between' },
          h('div', { class: 'fw-semibold' }, hz.title),
          h('div', { class: 'flex gap-2' }, levelTag(hz.level), statusTag(hz.status)),
        ),
        h('div', { class: 'muted mt-4', style: 'font-size:var(--fs-xs)' }, `发热团 #${hz.trackId} · 发现于 ${hz.foundDate}`),
        h('div', { class: 'mt-4' },
          h('div', { class: 'fw-medium mb-4' }, `处置措施（${hz.treatments.length}）`),
          ...hz.treatments.map((t) =>
            h('div', { class: 'card', style: 'padding:var(--sp-3);background:var(--c-surface-2);margin-bottom:8px' },
              h('div', { class: 'flex-between' },
                h('span', { class: 'tag tag-primary' }, TREATMENT_LABEL[t.type]),
                h('span', { class: 'dim mono' }, t.date),
              ),
              h('div', { class: 'mono mt-4', style: 'font-size:var(--fs-xs)' },
                `体积 ${t.beforeVolume.toFixed(1)} → ${t.afterVolume.toFixed(1)} m³　`,
                h('span', { class: volChange < 0 ? 'text-ok' : 'text-danger' }, `(${volChange.toFixed(1)}%)`),
              ),
              h('div', { class: 'mono', style: 'font-size:var(--fs-xs)' }, `最高温 ${t.beforeMaxTemp.toFixed(1)} → ${t.afterMaxTemp.toFixed(1)} ℃　时长 ${t.durationHours}h`),
            ),
          ),
          h('button', { class: 'btn btn-sm mt-4', onClick: () => addTreatment(hz) }, '添加处置措施'),
        ),
      )
    }))

  root.append(
    h('div', { class: 'flex-between mb-4' },
      h('div', {}, h('h2', { class: 'page-title' }, `隐患处置 · ${w.name}`), h('p', { class: 'page-sub', style: 'margin:0' }, '机械通风、环流熏蒸、倒仓措施前后效果对比')),
      h('button', { class: 'btn btn-primary', onClick: newHazard }, '登记隐患'),
    ),
    h('div', { class: 'card mb-4' },
      h('div', { class: 'card-title' }, `当前发热团（${latestBlobs.length}）`),
      h('div', { class: 'flex gap-3', style: 'flex-wrap:wrap' },
        ...latestBlobs.map((b) => h('span', { class: 'tag tag-danger' }, `#${b.trackId} ${b.maxTemp.toFixed(1)}℃ / ${b.volume.toFixed(1)}m³`)),
      ),
    ),
    cards,
  )
}
