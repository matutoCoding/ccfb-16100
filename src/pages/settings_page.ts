// 设置页：网格分辨率、等值面阈值、播放帧率、主题、数据管理
import { getState, updateSettings, applyTheme } from '../app/state'
import { resetAllData, settingsRepo } from '../core/repository'
import { regenerateWarehouseData } from '../core/seed'
import { clearEl, h, toast } from '../app/dom'
import type { AppSettings } from '../types'
import { DEFAULT_SETTINGS } from '../types'

export const renderSettingsPage = async (root: HTMLElement): Promise<void> => {
  clearEl(root)
  const state = getState()
  const s = state.settings

  const resolutionInput = h('input', { class: 'input', type: 'number', min: 32, max: 200, value: String(s.gridResolution) }) as HTMLInputElement
  const fpsInput = h('input', { class: 'input', type: 'number', min: 1, max: 20, value: String(s.playbackFps) }) as HTMLInputElement
  const opacityInput = h('input', { class: 'input', type: 'number', step: '0.05', min: 0.1, max: 1, value: String(s.surfaceOpacity) }) as HTMLInputElement
  const offsetsInput = h('input', { class: 'input', value: s.isoOffsets.join(','), placeholder: '3,5,8' }) as HTMLInputElement
  const themeSelect = h('select', { class: 'select' },
    h('option', { value: 'system' }, '跟随系统'),
    h('option', { value: 'light' }, '浅色'),
    h('option', { value: 'dark' }, '深色'),
  ) as HTMLSelectElement
  themeSelect.value = s.theme

  const field = (label: string, input: HTMLElement, hint?: string) =>
    h('div', { class: 'field' }, h('label', {}, label), input, hint ? h('span', { class: 'dim', style: 'font-size:12px;margin-top:2px' }, hint) : null)

  const save = async () => {
    const offsets = offsetsInput.value.split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x) && x > 0)
    const patch: Partial<AppSettings> = {
      gridResolution: Math.max(32, Math.min(200, Number(resolutionInput.value))),
      playbackFps: Math.max(1, Math.min(20, Number(fpsInput.value))),
      surfaceOpacity: Math.max(0.1, Math.min(1, Number(opacityInput.value))),
      isoOffsets: offsets.length ? offsets : DEFAULT_SETTINGS.isoOffsets,
      theme: themeSelect.value as AppSettings['theme'],
    }
    await updateSettings(patch)
    applyTheme(patch.theme ?? 'system')
    toast('设置已保存')
  }

  const regenerate = async () => {
    if (!state.currentWarehouseId) return
    await regenerateWarehouseData(state.currentWarehouseId)
    toast('巡测数据已重新生成')
  }

  const resetData = async () => {
    if (!confirm('确认清空全部业务数据？此操作不可恢复')) return
    await resetAllData()
    location.reload()
  }

  const resetSettings = async () => {
    await settingsRepo.save(DEFAULT_SETTINGS)
    await updateSettings(DEFAULT_SETTINGS)
    applyTheme(DEFAULT_SETTINGS.theme)
    toast('已恢复默认设置')
    renderSettingsPage(root)
  }

  root.append(
    h('h2', { class: 'page-title' }, '系统设置'),
    h('p', { class: 'page-sub' }, '网格、等值面、播放与显示参数，保存后三维粮情页生效'),

    h('div', { class: 'card' },
      h('div', { class: 'card-title' }, '计算参数'),
      h('div', { class: 'grid-2' },
        field('网格每边格数', resolutionInput, '可调到 200，越高越精细，200³ 阈值切换约 0.5~1 秒'),
        field('播放帧率 (FPS)', fpsInput, '时间轴自动播放速度'),
      ),
      h('div', { class: 'grid-2 mt-4' },
        field('等值面相对仓温偏移 (℃)', offsetsInput, '逗号分隔，按从外到内多层半透明叠加'),
        field('等值面不透明度', opacityInput),
      ),
      h('div', { class: 'btn-row mt-4' }, h('button', { class: 'btn btn-primary', onClick: save }, '保存设置')),
    ),

    h('div', { class: 'card' },
      h('div', { class: 'card-title' }, '外观'),
      field('主题', themeSelect),
      h('div', { class: 'btn-row mt-4' }, h('button', { class: 'btn', onClick: resetSettings }, '恢复默认')),
    ),

    h('div', { class: 'card' },
      h('div', { class: 'card-title' }, '数据管理（IndexedDB）'),
      h('div', { class: 'muted mb-4', style: 'font-size:var(--fs-sm)' }, '仓房、电缆、测点、巡测、隐患均存储在浏览器本地 IndexedDB，不上传服务器'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onClick: regenerate }, '重新生成当前仓巡测'),
        h('button', { class: 'btn btn-danger', onClick: resetData }, '清空全部数据'),
      ),
    ),

    h('div', { class: 'card' },
      h('div', { class: 'card-title' }, '验收指标自查'),
      h('ul', { class: 'muted', style: 'font-size:var(--fs-sm);line-height:1.9;padding-left:20px' },
        h('li', {}, '等值面水密：欧拉示性数 = 2，零破洞、零非流形边'),
        h('li', {}, '发热团体积与数网格体积差 < 2%'),
        h('li', {}, '200³ 网格阈值切换 1 秒内出面'),
        h('li', {}, '坏点/断线读数 NaN，插值跳过，不作为 0℃'),
        h('li', {}, '二义面 Nielson 渐近线判定，跨格拓扑一致'),
      ),
      h('div', { class: 'mt-4' }, h('button', { class: 'btn btn-sm', onClick: () => toast('请在项目根目录运行 npm test 查看完整验收') }, '查看验收方式')),
    ),
  )
}
