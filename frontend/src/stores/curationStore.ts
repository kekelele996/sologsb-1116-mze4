import { createStore } from 'zustand/vanilla'
import type { CurationEvent } from '@/types'
import { curationTransaction, db, syncAll } from '@/hooks/usePersistentStore'
import {
  type MergePlan,
  type SplitPlan,
  previewMerge,
  previewSplit
} from '@/utils/guards'
import { recordStore } from './recordStore'
import { sporeStore } from './sporeStore'
import { pointStore } from './pointStore'
import { identifyStore } from './identifyStore'

export interface CurationState {
  events: CurationEvent[]
  loaded: boolean
  hydrate: () => Promise<void>
  merge: (plan: MergePlan) => Promise<void>
  split: (plan: SplitPlan) => Promise<void>
}

/** 重新载入受整理影响的三张业务表 + 整理事件表 */
async function rehydrateAll(): Promise<void> {
  await Promise.all([
    recordStore.getState().hydrate(),
    sporeStore.getState().hydrate(),
    identifyStore.getState().hydrate(),
    curationStore.getState().hydrate()
  ])
}

export const curationStore = createStore<CurationState>((set) => ({
  events: [],
  loaded: false,
  hydrate: async () => {
    const events = await syncAll<CurationEvent>(db.curations)
    events.sort((a, b) => b.date.localeCompare(a.date))
    set({ events, loaded: true })
  },
  merge: async (plan) => {
    // 先在内存里预演并跑完全部安全校验；不过则直接抛错，不打开写事务
    const { records, spores, identifies, points } = snapshotStores()
    const events = await db.curations.toArray()
    const preview = previewMerge(plan, { records, spores, identifies, points, events })
    await curationTransaction(async () => {
      await db.records.bulkPut(preview.records)
      await db.spores.bulkPut(preview.spores)
      await db.identifies.bulkPut(preview.identifies)
      await db.curations.put(preview.event)
    })
    await rehydrateAll()
  },
  split: async (plan) => {
    const { records, spores, identifies, points } = snapshotStores()
    const events = await db.curations.toArray()
    const preview = previewSplit(plan, { records, spores, identifies, points, events })
    await curationTransaction(async () => {
      await db.records.bulkPut(preview.records)
      await db.spores.bulkPut(preview.spores)
      await db.identifies.bulkPut(preview.identifies)
      await db.curations.put(preview.event)
    })
    await rehydrateAll()
  }
}))

/** 取四张表当前快照（预演必须基于最新已落库数据，避免与界面状态错位） */
function snapshotStores() {
  return {
    records: recordStore.getState().records,
    spores: sporeStore.getState().spores,
    identifies: identifyStore.getState().logs,
    points: pointStore.getState().points
  }
}
