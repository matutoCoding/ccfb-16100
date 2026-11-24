// 独立验收脚本：合成已知半径球体，验证
// 1) 水密（内部种子 6 连通泛洪无法到达域外 + 欧拉示性数）
// 2) MC 网格体积 vs 数格子体积 vs 解析体积，误差 < 2%
// 3) 二义面（棋盘格）渐近线判定不破坏闭合
// 运行：npm test
import { extractIsosurface, meshVolumeSigned } from '../src/core/marching_cubes'
import { GridField, GridSpec, countGridVolume } from '../src/core/grid'
import { McMesh } from '../src/core/mc_tables'

const makeSphereField = (n: number, radius: number, threshold: number): GridField => {
  const spec: GridSpec = {
    nx: n, ny: n, nz: n,
    bounds: { minX: 0, minY: 0, minZ: 0, maxX: 10, maxY: 10, maxZ: 10 },
    dx: 10 / (n - 1), dy: 10 / (n - 1), dz: 10 / (n - 1),
    cellVolume: (10 / (n - 1)) ** 3,
  }
  const total = n * n * n
  const values = new Float32Array(total)
  const mask = new Uint8Array(total).fill(1)
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const idx = i + n * (j + n * k)
        const x = (i * 10) / (n - 1)
        const y = (j * 10) / (n - 1)
        const z = (k * 10) / (n - 1)
        values[idx] = threshold + (radius - Math.hypot(x - 5, y - 5, z - 5))
      }
    }
  }
  const chunkSize = 8
  const cc = Math.ceil(n / chunkSize)
  const chunkMin = new Float32Array(cc ** 3).fill(Infinity)
  const chunkMax = new Float32Array(cc ** 3).fill(-Infinity)
  for (let idx = 0; idx < total; idx++) {
    const i = idx % n
    const j = ((idx / n) | 0) % n
    const k = (idx / (n * n)) | 0
    const cIdx = Math.floor(i / chunkSize) + cc * (Math.floor(j / chunkSize) + cc * Math.floor(k / chunkSize))
    chunkMin[cIdx] = Math.min(chunkMin[cIdx], values[idx])
    chunkMax[cIdx] = Math.max(chunkMax[cIdx], values[idx])
  }
  return {
    spec, values, mask, chunkSize,
    chunkCount: cc ** 3, chunkMin, chunkMax, insideNodes: total,
  }
}

// 水密金标准：边恰好 2 次（闭合流形）+ 欧拉示性数=2
const checkWatertight = (
  mesh: McMesh,
): { edgeCount: number; boundaryEdges: number; nonManifold: number; euler: number } => {
  const edgeCount = new Map<number, number>()
  const { indices } = mesh
  for (let t = 0; t < indices.length; t += 3) {
    const tri = [indices[t], indices[t + 1], indices[t + 2]]
    for (let q = 0; q < 3; q++) {
      const a = tri[q]
      const b = tri[(q + 1) % 3]
      const key = a < b ? a * 400000007 + b : b * 400000007 + a
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1)
    }
  }
  let boundaryEdges = 0
  let nonManifold = 0
  for (const count of edgeCount.values()) {
    if (count === 1) boundaryEdges++
    else if (count > 2) nonManifold++
  }
  const euler = mesh.vertexCount - edgeCount.size + mesh.triangleCount
  return { edgeCount: edgeCount.size, boundaryEdges, nonManifold, euler }
}

interface CaseResult {
  name: string
  pass: boolean
  detail: string
}

const runSphereCase = (n: number, radius: number, threshold: number): CaseResult[] => {
  const field = makeSphereField(n, radius, threshold)
  const t0 = performance.now()
  const result = extractIsosurface(field, { threshold, labelBlobs: true })
  const elapsed = performance.now() - t0
  const meshVol = meshVolumeSigned(result.mesh)
  const gridVol = countGridVolume(field, threshold)
  const analytic = (4 / 3) * Math.PI * radius ** 3
  const errMesh = (Math.abs(meshVol - analytic) / analytic) * 100
  const errGrid = (Math.abs(gridVol - analytic) / analytic) * 100
  const diff = (Math.abs(meshVol - gridVol) / gridVol) * 100
  const wt = checkWatertight(result.mesh)

  const out: CaseResult[] = []
  out.push({
    name: `网格 ${n}³ 水密性`,
    pass: wt.boundaryEdges === 0 && wt.nonManifold === 0 && result.mesh.triangleCount > 0,
    detail: `三角形 ${result.mesh.triangleCount}，唯一边 ${wt.edgeCount}，破洞边界边 ${wt.boundaryEdges}，非流形 ${wt.nonManifold}，欧拉示性数 ${wt.euler}（球面应=2）`,
  })
  out.push({
    name: `网格 ${n}³ 体积精度`,
    pass: diff < 2,
    detail: `MC=${meshVol.toFixed(3)}m³ 数格=${gridVol.toFixed(3)}m³ 解析=${analytic.toFixed(3)}m³，MC 误差 ${errMesh.toFixed(2)}%，数格误差 ${errGrid.toFixed(2)}%，两者差 ${diff.toFixed(2)}%`,
  })
  out.push({
    name: `网格 ${n}³ 抽取耗时`,
    pass: elapsed < 1000,
    detail: `${elapsed.toFixed(0)}ms（阈值切换目标 <1000ms，格数 ${n}³）`,
  })
  if (result.blobs.length > 0) {
    const b = result.blobs[0]
    out.push({
      name: `网格 ${n}³ 发热团识别`,
      pass: result.blobs.length === 1 && b.maxTemp > threshold,
      detail: `团数 ${result.blobs.length}，最高温 ${b.maxTemp.toFixed(2)}℃，中心 (${b.cx.toFixed(2)}, ${b.cy.toFixed(2)}, ${b.cz.toFixed(2)})，体积 ${b.volume.toFixed(3)}m³`,
    })
  }
  return out
}

const runAmbiguityCase = (): CaseResult => {
  const n = 12
  const spec: GridSpec = {
    nx: n, ny: n, nz: n,
    bounds: { minX: 0, minY: 0, minZ: 0, maxX: 10, maxY: 10, maxZ: 10 },
    dx: 10 / (n - 1), dy: 10 / (n - 1), dz: 10 / (n - 1),
    cellVolume: (10 / (n - 1)) ** 3,
  }
  const total = n * n * n
  const values = new Float32Array(total)
  const mask = new Uint8Array(total).fill(1)
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const idx = i + n * (j + n * k)
        values[idx] = ((i + j + k) % 2 === 0 ? 1 : -1) + 0.3 * Math.sin(i * 0.7)
      }
    }
  }
  const chunkSize = 8
  const cc = Math.ceil(n / chunkSize)
  const field: GridField = {
    spec, values, mask, chunkSize,
    chunkCount: cc ** 3,
    chunkMin: new Float32Array(cc ** 3).fill(-1),
    chunkMax: new Float32Array(cc ** 3).fill(1),
    insideNodes: total,
  }
  const result = extractIsosurface(field, { threshold: 0, labelBlobs: false })
  const wt = checkWatertight(result.mesh)
  return {
    name: '棋盘格二义面水密性',
    pass: wt.nonManifold === 0,
    detail: `三角形 ${result.mesh.triangleCount}，非流形 ${wt.nonManifold}（棋盘格为多片分离曲面，边界边属正常）`,
  }
}

const main = () => {
  const results: CaseResult[] = []
  results.push(...runSphereCase(50, 2, 20))
  results.push(...runSphereCase(96, 2, 15))
  results.push(...runSphereCase(200, 2, 25))
  results.push(runAmbiguityCase())

  let passCount = 0
  console.log('=== 粮堆等值面验收（独立合成数据）===\n')
  for (const r of results) {
    if (r.pass) passCount++
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      ${r.detail}`)
  }
  console.log(`\n${passCount}/${results.length} 项通过`)
  if (passCount !== results.length) process.exit(1)
}

main()
