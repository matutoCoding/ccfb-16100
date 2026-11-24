// 发热团跨日期跟踪：按空间重叠率把不同巡测日的团追成同一条 track
import type { HeatBlob } from '../types'
import type { BlobInfo } from './marching_cubes'

export interface TrackMatch {
  trackId: number
  growthRate: number
}

const cellKeySet = (cells: number[]): Set<number> => {
  const set = new Set<number>()
  for (const c of cells) set.add(c)
  return set
}

// 重叠率 = 交集格数 / 较小团格数
const overlapRatio = (a: Set<number>, bCells: number[]): number => {
  if (bCells.length === 0) return 0
  let hit = 0
  for (const c of bCells) if (a.has(c)) hit++
  return hit / Math.min(a.size, bCells.length)
}

export interface TrackingContext {
  warehouseId: string
  inspectionId: string
  date: string
  threshold: number
  prevBlobs: HeatBlob[]
  // 上一次各 track 的格集合（从 blob 记录恢复，需外部缓存）
  prevCellsByTrack: Map<number, Set<number>>
  nextTrackId: number
}

// 给本次抽取的团分配 track：取重叠率最高且 >= 0.25 的旧 track；否则开新团
export const assignTracks = (
  blobs: BlobInfo[],
  ctx: TrackingContext,
): { records: Omit<HeatBlob, 'id'>[]; trackIds: number[]; nextTrackId: number } => {
  const usedTracks = new Set<number>()
  const trackIds: number[] = []
  let nextTrackId = ctx.nextTrackId

  const scored = blobs
    .map((b, idx) => ({ b, idx }))
    .sort((a, z) => z.b.cellCount - a.b.cellCount)

  for (const { b, idx } of scored) {
    let bestTrack = -1
    let bestRatio = 0.25
    for (const prev of ctx.prevBlobs) {
      if (usedTracks.has(prev.trackId)) continue
      const prevCells = ctx.prevCellsByTrack.get(prev.trackId)
      if (!prevCells) continue
      const ratio = overlapRatio(prevCells, b.cells)
      if (ratio > bestRatio) {
        bestRatio = ratio
        bestTrack = prev.trackId
      }
    }
    if (bestTrack < 0) {
      bestTrack = nextTrackId++
    }
    usedTracks.add(bestTrack)
    trackIds[idx] = bestTrack
  }

  const records: Omit<HeatBlob, 'id'>[] = blobs.map((b, idx) => {
    const trackId = trackIds[idx]
    const prev = ctx.prevBlobs.find((p) => p.trackId === trackId)
    const dayGap = prev
      ? Math.max(1, (Date.parse(ctx.date) - Date.parse(prev.date)) / 86400000)
      : 1
    const growthRate = prev ? (b.volume - prev.volume) / dayGap : 0
    return {
      warehouseId: ctx.warehouseId,
      trackId,
      inspectionId: ctx.inspectionId,
      date: ctx.date,
      threshold: ctx.threshold,
      voxelCount: b.cellCount,
      volume: b.volume,
      gridVolume: b.gridVolume,
      maxTemp: b.maxTemp,
      centerX: b.cx,
      centerY: b.cy,
      centerZ: b.cz,
      growthRate,
    }
  })

  return { records, trackIds, nextTrackId }
}

// 按增长速度排序（长得快的排前面），新增团按体积排
export const sortByGrowth = (records: Omit<HeatBlob, 'id'>[]): Omit<HeatBlob, 'id'>[] =>
  [...records].sort((a, b) => b.growthRate - a.growthRate || b.volume - a.volume)
