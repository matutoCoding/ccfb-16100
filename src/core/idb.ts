// IndexedDB Promise 封装：结构化克隆直接存 Float32Array

const DB_NAME = 'grain-workbench'
const DB_VERSION = 1

export const STORES = {
  warehouses: 'warehouses',
  cables: 'cables',
  sensors: 'sensors',
  inspections: 'inspections',
  blobs: 'blobs',
  hazards: 'hazards',
  settings: 'settings',
} as const

let dbPromise: Promise<IDBDatabase> | null = null

const openDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const name of Object.values(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: 'id' })
          if (name !== 'settings') store.createIndex('warehouseId', 'warehouseId', { unique: false })
        }
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

const tx = async <T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    const req = fn(t.objectStore(store))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export const idbPut = async <T>(store: string, value: T): Promise<IDBValidKey> =>
  tx(store, 'readwrite', (s) => s.put(value as unknown as object))

export const idbGet = async <T>(store: string, key: string): Promise<T | undefined> =>
  tx(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>)

export const idbGetAll = async <T>(store: string): Promise<T[]> =>
  tx(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>)

export const idbDelete = async (store: string, key: string): Promise<undefined> =>
  tx(store, 'readonly', (s) => s.delete(key) as IDBRequest<undefined>)

export const idbClear = async (store: string): Promise<undefined> =>
  tx(store, 'readwrite', (s) => s.clear() as IDBRequest<undefined>)

// 按 warehouseId 索引查询
export const idbQueryWarehouse = async <T>(store: string, warehouseId: string): Promise<T[]> => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readonly')
    const idx = t.objectStore(store).index('warehouseId')
    const req = idx.getAll(warehouseId) as IDBRequest<T[]>
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export const iddBulkPut = async <T>(store: string, items: T[]): Promise<void> => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite')
    const s = t.objectStore(store)
    for (const item of items) s.put(item as unknown as object)
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
  })
}
