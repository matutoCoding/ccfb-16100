// 极简 DOM 构建辅助 + hash 路由
export type Route =
  | 'warehouse'
  | 'cable'
  | 'inspection'
  | 'scene3d'
  | 'hazard'
  | 'settings'

export const ROUTES: { key: Route; label: string; icon: string }[] = [
  { key: 'warehouse', label: '仓房档案', icon: 'warehouse' },
  { key: 'cable', label: '电缆布置', icon: 'cable' },
  { key: 'inspection', label: '巡测数据', icon: 'inspection' },
  { key: 'scene3d', label: '三维粮情', icon: 'cube' },
  { key: 'hazard', label: '隐患处置', icon: 'alert' },
  { key: 'settings', label: '设置', icon: 'gear' },
]

export const currentRoute = (): Route => {
  const r = location.hash.replace('#/', '') as Route
  return ROUTES.some((x) => x.key === r) ? r : 'warehouse'
}

export const navigate = (route: Route): void => {
  location.hash = `#/${route}`
}

export const onRouteChange = (fn: (r: Route) => void): (() => void) => {
  const handler = () => fn(currentRoute())
  window.addEventListener('hashchange', handler)
  return () => window.removeEventListener('hashchange', handler)
}

// h 标签名 -> 元素，支持属性和子节点
type Child = Node | string | null | undefined | false
export const h = (
  tag: string,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElement => {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = String(v)
    else if (k === 'dataset') Object.assign(el.dataset, v)
    else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener)
    } else if (k === 'html') el.innerHTML = String(v)
    else if (v !== null && v !== undefined) el.setAttribute(k, String(v))
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    el.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return el
}

export const clearEl = (el: HTMLElement): void => {
  el.replaceChildren()
}

// toast 提示
export const toast = (message: string): void => {
  let host = document.querySelector<HTMLElement>('.toast-host')
  if (!host) {
    host = h('div', { class: 'toast-host' })
    document.body.append(host)
  }
  const item = h('div', { class: 'toast' }, message)
  host.append(item)
  setTimeout(() => item.remove(), 2800)
}

// 模态框
export const modal = (content: HTMLElement, title: string): (() => void) => {
  const mask = h('div', { class: 'modal-mask' })
  const box = h('div', { class: 'modal' }, h('h3', { class: 'modal-title' }, title), content)
  mask.append(box)
  mask.addEventListener('click', (ev) => {
    if (ev.target === mask) close()
  })
  document.body.append(mask)
  const close = () => mask.remove()
  return close
}

// 线性 SVG 图标（统一线宽 1.7，currentColor）
const PATHS: Record<string, string> = {
  warehouse: 'M3 21V9l9-5 9 5v12M9 21v-6h6v6M3 21h18',
  cable: 'M7 3v18M7 7h10M7 12h10M7 17h10M17 3v18',
  inspection: 'M4 5h16v14H4zM4 9h16M8 3v4M16 3v4M8 13h5M8 16h8',
  cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM12 3v18M4 7.5l8 4.5 8-4.5',
  alert: 'M12 3l10 18H2L12 3zM12 10v4M12 17.5v.5',
  gear: 'M12 8a4 4 0 100 8 4 4 0 000-8zM3 12h3M18 12h3M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1',
}

export const icon = (name: string, size = 18): SVGSVGElement => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.7')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', PATHS[name] ?? PATHS.cube)
  svg.append(path)
  return svg
}
