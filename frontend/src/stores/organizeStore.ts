import { createStore } from 'zustand/vanilla'
import type { OrganizeLog } from '@/types'
import { db, syncAll, syncPut } from '@/hooks/usePersistentStore'

export interface OrganizeState {
  logs: OrganizeLog[]
  loaded: boolean
  hydrate: () => Promise<void>
  add: (log: OrganizeLog) => Promise<void>
}

export const organizeStore = createStore<OrganizeState>((set, get) => ({
  logs: [],
  loaded: false,
  hydrate: async () => {
    const logs = await syncAll<OrganizeLog>(db.organizations)
    logs.sort((a, b) => b.at.localeCompare(a.at))
    set({ logs, loaded: true })
  },
  add: async (log) => {
    await syncPut<OrganizeLog>(db.organizations, log)
    await get().hydrate()
  }
}))
