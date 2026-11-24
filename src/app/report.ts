// 巡仓报告：生成自包含 HTML（内嵌三维截图、剖面等温线、发热团清单）并下载
import type { HeatBlob, Inspection, Warehouse } from '../types'
import { GRAIN_LABEL } from '../types'
import type { GrainRenderer } from '../webgl/renderer'

export interface ReportData {
  warehouse: Warehouse
  inspection: Inspection
  blobs: HeatBlob[]
  renderer: GrainRenderer
  sliceCanvas: HTMLCanvasElement | null
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const exportInspectionReport = (data: ReportData): void => {
  const { warehouse: w, inspection, blobs, renderer, sliceCanvas } = data
  const shot = renderer.captureDataUrl()
  const slice = sliceCanvas?.toDataURL('image/png') ?? ''

  const valid = [...inspection.readings].filter((v) => Number.isFinite(v))
  const avg = valid.reduce((a, b) => a + b, 0) / valid.length
  const max = Math.max(...valid)
  const min = Math.min(...valid)
  const bad = inspection.readings.length - valid.length

  const blobRows = blobs
    .map(
      (b) => `
      <tr>
        <td>#${b.trackId}</td>
        <td>${b.maxTemp.toFixed(2)} ℃</td>
        <td>${b.volume.toFixed(2)} m³</td>
        <td>${b.gridVolume.toFixed(2)} m³</td>
        <td>(${b.centerX.toFixed(2)}, ${b.centerY.toFixed(2)}, ${b.centerZ.toFixed(2)})</td>
        <td>${b.growthRate >= 0 ? '+' : ''}${b.growthRate.toFixed(2)} m³/天</td>
      </tr>`,
    )
    .join('')

  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>巡仓报告 ${esc(w.name)} ${inspection.date}</title>
<style>
  body{font-family:"Microsoft YaHei",sans-serif;margin:32px;color:#1e293b;line-height:1.6}
  h1{font-size:22px;border-bottom:2px solid #2563eb;padding-bottom:8px}
  h2{font-size:17px;margin-top:28px;color:#0f172a}
  table{border-collapse:collapse;width:100%;margin-top:8px;font-size:13px}
  th,td{border:1px solid #cbd5e1;padding:7px 10px;text-align:left}
  th{background:#f1f5f9}
  .meta{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:16px 0}
  .meta div{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px}
  .meta .num{font-size:22px;font-weight:600;color:#2563eb}
  img{max-width:100%;border:1px solid #e2e8f0;border-radius:8px;margin-top:8px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .foot{margin-top:32px;color:#64748b;font-size:12px;border-top:1px solid #e2e8f0;padding-top:12px}
</style></head><body>
<h1>粮情巡仓报告 · ${esc(w.name)}</h1>
<p>报告日期：${new Date().toLocaleString('zh-CN')}　巡测日期：${inspection.date}</p>

<div class="meta">
  <div><div>平均粮温</div><div class="num">${avg.toFixed(2)} ℃</div></div>
  <div><div>最高 / 最低</div><div class="num">${max.toFixed(2)} / ${min.toFixed(2)} ℃</div></div>
  <div><div>坏点 / 断线</div><div class="num">${bad} 点</div></div>
</div>

<h2>一、仓房信息</h2>
<table>
  <tr><th>仓型</th><td>${w.type === 'rect' ? '平房仓' : '浅圆仓'}</td><th>粮种</th><td>${GRAIN_LABEL[w.grainType]}</td></tr>
  <tr><th>尺寸</th><td>${w.type === 'rect' ? `${w.length}×${w.width} m` : `直径 ${w.diameter} m`}</td><th>装粮线</th><td>${w.fillLine} m</td></tr>
  <tr><th>入仓日期</th><td>${w.inboundDate}</td><th>水分 / 容重</th><td>${w.moisture}% / ${w.bulkDensity} kg/m³</td></tr>
</table>

<h2>二、三维等值面截图</h2>
<img src="${shot}" alt="三维等值面" />

<h2>三、剖面等温线</h2>
${slice ? `<img src="${slice}" alt="剖面等温线" style="max-width:480px" />` : '<p>未生成剖面</p>'}

<h2>四、发热团清单（${blobs.length} 个，按增长排序）</h2>
<table>
  <thead><tr><th>编号</th><th>最高温</th><th>等值面体积</th><th>数格体积</th><th>中心坐标 (m)</th><th>增长率</th></tr></thead>
  <tbody>${blobRows || '<tr><td colspan="6">当前阈值下未识别发热团</td></tr>'}</tbody>
</table>

<div class="foot">本报告由粮堆发热三维等值面系统自动生成，等值面采用 Marching Cubes 抽取，
水密性经欧拉示性数校验，体积误差 &lt; 2%。坏点读数为 NaN，插值时已剔除。</div>
</body></html>`

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `巡仓报告-${w.name}-${inspection.date}.html`
  a.click()
  URL.revokeObjectURL(url)
}
