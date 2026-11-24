// 数学基础：向量、随机数、插值核

export type Vec3 = { x: number; y: number; z: number }

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})
export const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z)
export const norm = (a: Vec3): Vec3 => {
  const l = len(a)
  return l < 1e-12 ? { x: 0, y: 0, z: 0 } : scale(a, 1 / l)
}
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
export const dist2 = (ax: number, ay: number, az: number, b: Vec3): number => {
  const dx = ax - b.x
  const dy = ay - b.y
  const dz = az - b.z
  return dx * dx + dy * dy + dz * dz
}

// 确定性 PRNG，保证测试数据可复现
export const mulberry32 = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 字符串哈希到 32 位整数（FNV-1a）
export const hashStr = (s: string): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// 三维高斯
export const gaussian3 = (
  x: number, y: number, z: number,
  cx: number, cy: number, cz: number,
  sx: number, sy: number, sz: number,
): number => {
  const dx = (x - cx) / sx
  const dy = (y - cy) / sy
  const dz = (z - cz) / sz
  return Math.exp(-0.5 * (dx * dx + dy * dy + dz * dz))
}

export interface WeightedSample { x: number; y: number; z: number; value: number }

// 平面 IDW（xy 平面，幂次 power），用于粮面高程拟合
export const idw2d = (
  x: number, y: number,
  points: { x: number; y: number; z: number }[],
  power = 2,
): number => {
  let wSum = 0
  let vSum = 0
  for (const p of points) {
    const d2 = (x - p.x) ** 2 + (y - p.y) ** 2
    if (d2 < 1e-10) return p.z
    const w = 1 / d2 ** (power / 2)
    wSum += w
    vSum += w * p.z
  }
  return vSum / wSum
}

// 三维 IDW（网格插值兜底用）
export const idw3d = (x: number, y: number, z: number, samples: WeightedSample[], power = 2): number => {
  let wSum = 0
  let vSum = 0
  for (const s of samples) {
    const d2 = dist2(x, y, z, s)
    if (d2 < 1e-10) return s.value
    const w = 1 / d2 ** (power / 2)
    wSum += w
    vSum += w * s.value
  }
  return vSum / wSum
}

// 露点温度（简化 Magnus，℃ / %RH）
export const dewPoint = (temp: number, rh: number): number => {
  const a = 17.27
  const b = 237.7
  const alpha = (a * temp) / (b + temp) + Math.log(rh / 100)
  return (b * alpha) / (a - alpha)
}

export const fmt = (v: number, digits = 1): string => v.toFixed(digits)
export const fmtDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
