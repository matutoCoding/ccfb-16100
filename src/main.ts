import './styles/global.css'
import { initApp, getState, subscribe } from './app/state'
import { ROUTES, currentRoute, h, icon, navigate, onRouteChange } from './app/dom'
import { renderWarehousePage } from './pages/warehouse_page'
import { renderCablePage } from './pages/cable_page'
import { renderInspectionPage } from './pages/inspection_page'
import { renderScenePage } from './pages/scene_page'
import { renderHazardPage } from './pages/hazard_page'
import { renderSettingsPage } from './pages/settings_page'
import type { Route } from './app/dom'

const renderShell = (): void => {
  const app = document.querySelector<HTMLElement>('#app')
  if (!app) return
  const route = currentRoute()
  const state = getState()

  const navItems = ROUTES.map((r) =>
    h(
      'button',
      {
        class: `nav-item ${r.key === route ? 'active' : ''}`,
        onClick: () => navigate(r.key),
      },
      icon(r.icon),
      h('span', {}, r.label),
    ),
  )

  const header = h(
    'header',
    { class: 'app-header' },
    h('div', { class: 'app-logo' }, icon('cube', 22), '粮堆发热三维等值面系统'),
    h(
      'div',
      { class: 'muted', style: 'margin-left:auto;font-size:var(--fs-xs)' },
      state.warehouses.length ? `${state.warehouses.length} 个仓房在档` : '',
    ),
  )

  const sidebar = h('nav', { class: 'app-sidebar' }, ...navItems)
  const main = h('main', { class: 'app-main' })
  app.replaceChildren(h('div', { style: 'display:contents' }, header, h('div', { class: 'app-body' }, sidebar, main)))

  const pages: Record<Route, (el: HTMLElement) => void> = {
    warehouse: renderWarehousePage,
    cable: renderCablePage,
    inspection: renderInspectionPage,
    scene3d: renderScenePage,
    hazard: renderHazardPage,
    settings: renderSettingsPage,
  }
  pages[route](main)
}

const boot = async (): Promise<void> => {
  await initApp()
  if (!location.hash) location.hash = '#/warehouse'
  renderShell()
  subscribe(renderShell)
  onRouteChange(renderShell)
}

boot().catch((err) => {
  const app = document.querySelector<HTMLElement>('#app')
  if (app) {
    app.replaceChildren(
      h('div', { class: 'empty-state' }, h('div', { class: 'empty-title' }, '初始化失败'), h('div', { class: 'empty-sub' }, String(err))),
    )
  }
})
