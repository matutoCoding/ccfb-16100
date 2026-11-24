// Marching Cubes 核心拓扑
// 正确做法：格 12 条边上的交点作为图顶点；每个被穿过的格面给出交点配对
// （非二义面 1 对，二义面按 Nielson 渐近线判定给 2 对）；
// 每个交点恰好邻接两个面 => 图中度数为 2 => 自然形成一个或多个闭合环，
// 环跨格内部，扇形三角化即 MC 面片。相邻格共享边交点缓存与同一确定性
// 鞍点判定 => 水密、无洞、无翻面。

export interface McMesh {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  vertexCount: number
  triangleCount: number
}

// 8 角点编号约定
//            6 ---- 7
//           /|     /|
//          4 ---- 5 |      k(上)
//          | 2 ---|-3      | j
//          |/     |/       |/
//          0 ---- 1        +---- i(x)
export const CORNER_OFFSETS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0], // 0
  [1, 0, 0], // 1
  [1, 1, 0], // 2
  [0, 1, 0], // 3
  [0, 0, 1], // 4
  [1, 0, 1], // 5
  [1, 1, 1], // 6
  [0, 1, 1], // 7
]

// 12 条边：两端角点编号
export const EDGE_CORNERS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], // 0
  [1, 2], // 1
  [2, 3], // 2
  [3, 0], // 3
  [4, 5], // 4
  [5, 6], // 5
  [6, 7], // 6
  [7, 4], // 7
  [0, 4], // 8
  [1, 5], // 9
  [2, 6], // 10
  [3, 7], // 11
]

// 6 个面：corners[t] 与 corners[t+1] 之间夹的边恰为 edges[t]
export interface FaceDef {
  corners: readonly [number, number, number, number]
  edges: readonly [number, number, number, number]
}

export const FACES: readonly FaceDef[] = [
  { corners: [0, 1, 2, 3], edges: [0, 1, 2, 3] }, // 底 -z
  { corners: [4, 5, 6, 7], edges: [4, 5, 6, 7] }, // 顶 +z
  { corners: [0, 4, 5, 1], edges: [8, 4, 9, 0] }, // 前 -y
  { corners: [3, 2, 6, 7], edges: [2, 10, 6, 11] }, // 后 +y
  { corners: [0, 3, 7, 4], edges: [3, 11, 7, 8] }, // 左 -x
  { corners: [1, 5, 6, 2], edges: [9, 5, 10, 1] }, // 右 +x
]

// 二义面：对角同号且两对对角异号（4 条边全活动）
export const isAmbiguousFace = (inside: boolean[], face: FaceDef): boolean => {
  const [a, b, c, d] = face.corners.map((q) => inside[q])
  return a === c && b === d && a !== b
}

// Nielson 渐近线判定：双线性鞍点值
// S = (vb*vd - va*vc) / (vb + vd - va - vc)，a/c、b/d 为两对对角
export const saddleValue = (vals: number[], face: FaceDef): number => {
  const [ca, cb, cc, cd] = face.corners
  const va = vals[ca]
  const vb = vals[cb]
  const vc = vals[cc]
  const vd = vals[cd]
  const denom = vb + vd - va - vc
  if (Math.abs(denom) < 1e-9) return (va + vb + vc + vd) * 0.25
  return (vb * vd - va * vc) / denom
}

// 面内交点配对：返回若干 [边号, 边号]，表示同一根等值线段的两端
export const facePairings = (
  face: FaceDef,
  inside: boolean[],
  vals: number[],
  threshold: number,
): Array<[number, number]> => {
  const active = face.edges.filter((e) => {
    const [u, v] = EDGE_CORNERS[e]
    return inside[u] !== inside[v]
  })
  if (active.length === 0) return []
  if (active.length === 2) return [[active[0], active[1]]]

  // 4 条边全活动 => 二义面，渐近线判定
  const s = saddleValue(vals, face)
  const [c0, c1, c2, c3] = face.corners
  // 孤立角点：与面中心异侧的那一对对角，其相邻两边上的交点互相配对
  const centerInside = s >= threshold
  const isolatedInside = !centerInside ? inside[c0] : !inside[c0]
  // isolatedInside=true  => c0、c2（inside 一方）被等值线各自围起
  // isolatedInside=false => c1、c3（outside 一方）被围起
  const isolatedCorners = isolatedInside ? [c0, c2] : [c1, c3]
  const pairs: Array<[number, number]> = []
  for (const corner of isolatedCorners) {
    const t = face.corners.indexOf(corner)
    pairs.push([face.edges[(t + 3) % 4], face.edges[t]])
  }
  return pairs
}
