// 领域模型类型定义

export type WarehouseType = 'rect' | 'silo'
export type GrainType = 'wheat' | 'corn' | 'paddy' | 'soybean' | 'rapeseed'
export type PointStatus = 'ok' | 'bad' | 'offline'

// 粮面实测高程控制点（米，z 为相对仓内地坪的高程）
export interface SurfacePoint {
  x: number
  y: number
  z: number
}

export interface Warehouse {
  id: string
  name: string
  type: WarehouseType
  // 平房仓：长(x) 宽(y) 檐墙高；浅圆仓：diameter 直径
  length: number
  width: number
  diameter: number
  wallHeight: number
  fillLine: number // 设计装粮线高程（米）
  grainType: GrainType
  inboundDate: string // YYYY-MM-DD
  moisture: number // 水分 %
  bulkDensity: number // 容重 kg/m3
  surfacePoints: SurfacePoint[] // 粮面实测点，IDW 拟合
  createdAt: string
}

// 测温电缆
export interface Cable {
  id: string
  warehouseId: string
  code: string // 行列号如 R03C05，浅圆仓如 RING2-04
  ring: number // 平房仓固定 0；浅圆仓同心圈序号（0=中心）
  x: number // 悬挂位置（仓内局部坐标，米）
  y: number
  topZ: number // 悬挂点高程
  pointCount: number // 测温点数（随粮面高低变）
  spacing: number // 点间距（米，通常 1）
  firstDepth: number // 首点距粮面深度
  status: PointStatus // 整缆状态（offline=断线）
}

// 单个测点的静态档案
export interface SensorPoint {
  id: string
  cableId: string
  warehouseId: string
  index: number // 缆上序号，自粮面向下
  x: number
  y: number
  z: number
  status: PointStatus
}

// 一次巡测（一个仓一条记录，读数用紧凑 Float32 存 IndexedDB）
export interface Inspection {
  id: string
  warehouseId: string
  date: string // YYYY-MM-DD
  pointCount: number
  // 与 sensor 顺序对齐；NaN = 坏点/断线（插值跳过，绝不当 0 度）
  readings: Float32Array
  ambientTemp: number
  // 该次巡测的坏点/断线 id 列表（冗余存档，便于展示）
  badPointIds: string[]
  createdAt: string
}

// 发热团跟踪记录
export interface HeatBlob {
  id: string
  warehouseId: string
  trackId: number // 跨日期跟踪编号
  inspectionId: string
  date: string
  threshold: number // 抽取阈值（绝对值 ℃）
  voxelCount: number
  volume: number // 立方米，等值面网格体积
  gridVolume: number // 数格子参考体积
  maxTemp: number
  centerX: number
  centerY: number
  centerZ: number
  growthRate: number // 相对上一次同 track 的体积增长率 m3/天
}

// 隐患处置
export type TreatmentType = 'ventilation' | 'fumigation' | 'transfer'
export interface HazardCase {
  id: string
  warehouseId: string
  trackId: number
  title: string
  foundDate: string
  status: 'open' | 'treating' | 'closed'
  level: 'watch' | 'warning' | 'serious'
  treatments: Treatment[]
  note: string
}

export interface Treatment {
  id: string
  type: TreatmentType
  date: string
  durationHours: number
  note: string
  beforeVolume: number
  afterVolume: number
  beforeMaxTemp: number
  afterMaxTemp: number
}

export interface AppSettings {
  gridResolution: number // 每边格数（可调到 200）
  isoOffsets: number[] // 相对仓温的偏移阈值 [3,5,8]
  playbackFps: number
  theme: 'system' | 'light' | 'dark'
  surfaceOpacity: number
  autoReinterpolate: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  gridResolution: 96,
  isoOffsets: [3, 5, 8],
  playbackFps: 4,
  theme: 'system',
  surfaceOpacity: 0.35,
  autoReinterpolate: true,
}

export const GRAIN_LABEL: Record<GrainType, string> = {
  wheat: '小麦',
  corn: '玉米',
  paddy: '稻谷',
  soybean: '大豆',
  rapeseed: '油菜籽',
}

export const TREATMENT_LABEL: Record<TreatmentType, string> = {
  ventilation: '机械通风',
  fumigation: '环流熏蒸',
  transfer: '倒仓',
}
