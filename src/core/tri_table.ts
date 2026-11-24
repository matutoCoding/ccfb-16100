// Marching Cubes 完整三角连接表生成器
// 对 256 种角点内外配置，用「面配对 -> 边邻接图 -> 走闭合环 -> 3D 扇形」
// 离线枚举出每种 case 的三角形（以 12 条格边编号表示），生成静态查找表。
// 运行时直接查表，相邻格在共享面上拓扑天然一致 => 水密。
import { EDGE_CORNERS, FACES, facePairings } from './mc_tables'

const TABLE_SIZE = 256
const MAX_TRIS = 5

export const buildTriTable = (): Int8Array => {
  const table = new Int8Array(TABLE_SIZE * MAX_TRIS * 3).fill(-1)
  for (let mask = 0; mask < TABLE_SIZE; mask++) {
    const inside = Array.from({ length: 8 }, (_, c) => ((mask >> c) & 1) === 1)
    const vals = inside.map((b) => (b ? 1 : 0))
    const activeEdges: number[] = []
    for (let e = 0; e < 12; e++) {
      const [u, v] = EDGE_CORNERS[e]
      if (inside[u] !== inside[v]) activeEdges.push(e)
    }
    const adj = new Map<number, number[]>()
    for (const e of activeEdges) adj.set(e, [])
    for (const face of FACES) {
      for (const [ea, eb] of facePairings(face, inside, vals, 0.5)) {
        adj.get(ea)?.push(eb)
        adj.get(eb)?.push(ea)
      }
    }
    const visited = new Set<number>()
    const tris: number[] = []
    for (const start of activeEdges) {
      if (visited.has(start)) continue
      const loop: number[] = [start]
      visited.add(start)
      let prev = -1
      let cur = start
      for (;;) {
        const nbrs = adj.get(cur) as number[]
        const next = nbrs[0] === prev ? nbrs[1] : nbrs[0]
        if (next === start) break
        loop.push(next)
        visited.add(next)
        prev = cur
        cur = next
      }
      if (loop.length < 3) continue
      // 3D 扇形：固定以环首（最小边号）为扇心，确定性最强
      const fan = Math.min(...loop)
      const fanIdx = loop.indexOf(fan)
      const ordered = loop.slice(fanIdx).concat(loop.slice(0, fanIdx))
      for (let q = 1; q < ordered.length - 1; q++) {
        tris.push(ordered[0], ordered[q], ordered[q + 1])
      }
    }
    const base = mask * MAX_TRIS * 3
    for (let t = 0; t < Math.min(tris.length, MAX_TRIS * 3); t++) {
      table[base + t] = tris[t]
    }
  }
  return table
}

// 单例表（模块加载时一次性生成）
export const TRI_TABLE = buildTriTable()
export const TRIANGLES_PER_CASE = MAX_TRIS * 3
