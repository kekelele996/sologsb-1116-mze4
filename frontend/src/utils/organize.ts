import type { CollectPoint, FungusRecord, IdentifyLog, OrganizeLog, SporePrint } from '@/types'
import {
  CAP_MARGINS,
  CAP_SHAPES,
  CAP_TEXTURES,
  FLESH_REACTIONS,
  GILL_ATTACHMENTS,
  GILL_DENSITIES,
  RING_TYPES,
  VOLVA_TYPES
} from '@/types'
import { db } from '@/hooks/usePersistentStore'
import { uid } from './id'

/** 整理操作失败时抛出：调用方提示用户，且不改动任何既有记录 */
export class OrganizeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OrganizeError'
  }
}

/** 整理时的全量上下文（整理后的拟议状态） */
export interface OrganizeCtx {
  records: FungusRecord[]
  spores: SporePrint[]
  identifies: IdentifyLog[]
  points: CollectPoint[]
}

/** 可逐项选择的形态 / 关联字段（id、code 不参与合并） */
export interface ConflictField {
  key: keyof FungusRecord
  label: string
  kind: 'enum' | 'number' | 'text' | 'date' | 'point'
  options?: readonly string[]
}

/** 参与冲突比对的字段（按形态分区排列，便于界面逐项选择） */
export const CONFLICT_FIELDS: ConflictField[] = [
  { key: 'tempName', label: '暂定名', kind: 'text' },
  { key: 'pointId', label: '采集点', kind: 'point' },
  { key: 'fruitBodyCount', label: '子实体数量', kind: 'number' },
  { key: 'capDiameter', label: '菌盖直径(cm)', kind: 'number' },
  { key: 'capShape', label: '菌盖形状', kind: 'enum', options: CAP_SHAPES },
  { key: 'capMargin', label: '菌盖边缘', kind: 'enum', options: CAP_MARGINS },
  { key: 'capTexture', label: '表面质地', kind: 'enum', options: CAP_TEXTURES },
  { key: 'fleshThickness', label: '菌肉厚度(cm)', kind: 'number' },
  { key: 'fleshReaction', label: '变色反应', kind: 'enum', options: FLESH_REACTIONS },
  { key: 'attachment', label: '着生方式', kind: 'enum', options: GILL_ATTACHMENTS },
  { key: 'gillDensity', label: '菌褶密度', kind: 'enum', options: GILL_DENSITIES },
  { key: 'stipeLength', label: '菌柄长度(cm)', kind: 'number' },
  { key: 'stipeDiameter', label: '菌柄直径(cm)', kind: 'number' },
  { key: 'ring', label: '菌环', kind: 'enum', options: RING_TYPES },
  { key: 'volva', label: '菌托', kind: 'enum', options: VOLVA_TYPES },
  { key: 'odor', label: '气味', kind: 'text' },
  { key: 'hostTree', label: '关联树种', kind: 'text' },
  { key: 'collectDate', label: '采集日期', kind: 'date' },
  { key: 'collector', label: '采集人', kind: 'text' },
  { key: 'note', label: '备注', kind: 'text' }
]

/** 两条记录间取值不一致的字段（即需要逐项选择的冲突项） */
export function conflictFields(main: FungusRecord, source: FungusRecord): ConflictField[] {
  return CONFLICT_FIELDS.filter((field) => String(main[field.key]) !== String(source[field.key]))
}

/** 字段取值的可读文本（采集点字段翻译为点名） */
export function fieldDisplay(field: ConflictField, value: unknown, points: CollectPoint[]): string {
  if (field.kind === 'point') {
    return points.find((point) => point.id === value)?.name ?? '未关联采集点'
  }
  return value === null || value === undefined || value === '' ? '—' : String(value)
}

/* ---------------- 合并 ---------------- */

export interface MergePlan {
  main: FungusRecord
  source: FungusRecord
  /** 冲突字段取值：字段名 -> 'main' | 'source' */
  chosen: Record<string, 'main' | 'source'>
  /** 转到主条目的孢子印 id（其余留在来源快照） */
  transferredSporeIds: string[]
  /** 转到主条目的鉴定留痕 id（其余留在来源快照） */
  transferredIdentifyIds: string[]
}

function assignField<K extends keyof FungusRecord>(target: FungusRecord, key: K, value: FungusRecord[K]): void {
  target[key] = value
}

/** 按逐项选择结果，把来源字段并入主条目（未选择的字段保留主条目取值） */
function mergeFields(main: FungusRecord, source: FungusRecord, chosen: Record<string, 'main' | 'source'>): FungusRecord {
  const result: FungusRecord = { ...main }
  for (const field of CONFLICT_FIELDS) {
    if (chosen[field.key] === 'source') {
      assignField(result, field.key, source[field.key])
    }
  }
  return result
}

/* ---------------- 拆分 ---------------- */

export interface SplitDraft {
  code: string
  tempName: string
  pointId: string
  /** 分到本条的孢子印 id（其余留在原记录作为来源） */
  sporeIds: string[]
  /** 分到本条的鉴定留痕 id（其余留在原记录作为来源） */
  identifyIds: string[]
}

/* ---------------- 拟议状态校验 ---------------- */

/** 指针环检测：sourceId（拆分→原记录）与 mergedInto（合并快照→主条目） */
function findPointerCycles(records: FungusRecord[]): string[][] {
  const byId = new Map(records.map((record) => [record.id, record]))
  const state = new Map<string, 0 | 1 | 2>()
  const cycles: string[][] = []
  const stack: string[] = []

  function walk(id: string): void {
    state.set(id, 1)
    stack.push(id)
    const record = byId.get(id)
    const outs = [record?.sourceId, record?.mergedInto].filter(
      (x): x is string => typeof x === 'string' && byId.has(x)
    )
    for (const nxt of outs) {
      const st = state.get(nxt) ?? 0
      if (st === 1) {
        const idx = stack.indexOf(nxt)
        cycles.push([...stack.slice(idx), nxt])
      } else if (st === 0) {
        walk(nxt)
      }
    }
    stack.pop()
    state.set(id, 2)
  }

  for (const record of records) {
    if (!state.has(record.id)) walk(record.id)
  }
  return cycles
}

/**
 * 校验整理后的拟议状态。返回问题列表；为空才允许落库。
 * 任何一项不满足，调用方都应中止，原记录 / 孢子印 / 鉴定留痕一律不改。
 */
export function validateProposed(ctx: OrganizeCtx): string[] {
  const problems: string[] = []
  const { records, spores, identifies, points } = ctx
  const recordIds = new Set(records.map((record) => record.id))
  const pointIds = new Set(points.map((point) => point.id))

  // 1. 编号重复
  const codeCount = new Map<string, number>()
  for (const record of records) {
    codeCount.set(record.code, (codeCount.get(record.code) ?? 0) + 1)
  }
  for (const [code, count] of codeCount) {
    if (count > 1) problems.push(`采集编号「${code}」在整理后重复（${count} 条）`)
  }

  // 2. 来源互相指向（指针成环）
  const cycles = findPointerCycles(records)
  if (cycles.length > 0) {
    problems.push('来源记录互相指向形成循环：' + cycles.map((cycle) => cycle.join(' → ')).join('；'))
  }

  // 3. 关联缺失：孢子印 / 鉴定留痕指向不存在的条目
  for (const spore of spores) {
    if (!recordIds.has(spore.recordId)) {
      problems.push(`孢子印「${spore.color}」指向了不存在的条目（${spore.recordId}）`)
    }
  }
  for (const log of identifies) {
    if (!recordIds.has(log.recordId)) {
      problems.push(`鉴定结论「${log.conclusion}」指向了不存在的条目（${log.recordId}）`)
    }
  }

  // 4. 关联缺失：条目指向不存在的采集点 / 来源记录
  for (const record of records) {
    if (!pointIds.has(record.pointId)) {
      problems.push(`条目「${record.code}」关联了不存在的采集点（${record.pointId}）`)
    }
    if (record.sourceId && !recordIds.has(record.sourceId)) {
      problems.push(`条目「${record.code}」的来源记录不存在（${record.sourceId}）`)
    }
    if (record.mergedInto && !recordIds.has(record.mergedInto)) {
      problems.push(`条目「${record.code}」并入的主条目不存在（${record.mergedInto}）`)
    }
  }

  return problems
}

/** 合并两条记录：冲突字段逐项取值，孢子印与鉴定留痕按选择转移，未转移的随来源快照保留 */
export async function applyMerge(plan: MergePlan, ctx: OrganizeCtx): Promise<OrganizeLog> {
  const { main, source } = plan
  if (main.id === source.id) throw new OrganizeError('不能合并同一条记录')
  if (!ctx.records.some((record) => record.id === main.id)) throw new OrganizeError('主条目不存在')
  if (!ctx.records.some((record) => record.id === source.id)) throw new OrganizeError('来源条目不存在')
  if (source.mergedInto) {
    throw new OrganizeError(`来源「${source.code}」已是来源快照（已并入主条目），不能再次合并`)
  }
  if (main.mergedInto) {
    throw new OrganizeError(`主条目「${main.code}」本身是来源快照，请改用正式条目作为主条目`)
  }
  if (main.sourceId) {
    throw new OrganizeError(`主条目「${main.code}」是拆分结果，暂不支持作为合并主条目`)
  }

  const merged = mergeFields(main, source, plan.chosen)
  const snapshot: FungusRecord = { ...source, mergedInto: main.id }

  const transferredSporeIds = new Set(plan.transferredSporeIds)
  const transferredIdentifyIds = new Set(plan.transferredIdentifyIds)

  const nextRecords = ctx.records.map((record) =>
    record.id === main.id ? merged : record.id === source.id ? snapshot : record
  )
  const nextSpores = ctx.spores.map((spore) =>
    transferredSporeIds.has(spore.id) ? { ...spore, recordId: main.id } : spore
  )
  const nextIdentifies = ctx.identifies.map((log) =>
    transferredIdentifyIds.has(log.id) ? { ...log, recordId: main.id } : log
  )

  const problems = validateProposed({ records: nextRecords, spores: nextSpores, identifies: nextIdentifies, points: ctx.points })
  if (problems.length > 0) throw new OrganizeError(problems.join('；'))

  const log: OrganizeLog = {
    id: uid('org'),
    kind: 'merge',
    at: new Date().toISOString(),
    mainId: main.id,
    mainCode: main.code,
    sourceId: source.id,
    sourceCode: source.code,
    chosen: { ...plan.chosen },
    transferredSporeIds: [...plan.transferredSporeIds],
    transferredIdentifyIds: [...plan.transferredIdentifyIds]
  }

  await db.transaction('rw', [db.records, db.spores, db.identifies, db.organizations], async () => {
    await db.records.put(merged)
    await db.records.put(snapshot)
    await db.spores.bulkPut(nextSpores.filter((spore) => transferredSporeIds.has(spore.id)))
    await db.identifies.bulkPut(nextIdentifies.filter((item) => transferredIdentifyIds.has(item.id)))
    await db.organizations.put(log)
  })

  return log
}

/** 把一条混装记录拆成至少两条独立条目：每条新条目都有新采集编号，原编号与字段留作来源 */
export async function applySplit(origin: FungusRecord, drafts: SplitDraft[], ctx: OrganizeCtx): Promise<OrganizeLog> {
  if (!ctx.records.some((record) => record.id === origin.id)) throw new OrganizeError('待拆分的原记录不存在')
  if (origin.mergedInto) throw new OrganizeError(`「${origin.code}」已是来源快照，不能拆分`)
  if (origin.sourceId) throw new OrganizeError(`「${origin.code}」本身已是拆分结果，不能再次拆分`)
  if (drafts.length < 2) throw new OrganizeError('至少拆分为 2 条独立条目')

  const trimmed = drafts.map((draft) => ({ ...draft, code: draft.code.trim(), tempName: draft.tempName.trim() }))
  if (trimmed.some((draft) => !draft.code)) throw new OrganizeError('每条新条目都必须填写新的采集编号')
  if (new Set(trimmed.map((draft) => draft.code)).size !== trimmed.length) {
    throw new OrganizeError('拆分后的新采集编号之间有重复，请检查')
  }

  // 观察分配唯一性：一条孢子印 / 鉴定留痕不能同时分到两条新条目
  const sporeOwner = new Map<string, string>()
  const identifyOwner = new Map<string, string>()
  trimmed.forEach((draft) => {
    for (const sporeId of draft.sporeIds) {
      if (sporeOwner.has(sporeId)) throw new OrganizeError(`同一条孢子印被重复分配到两条新条目（${sporeId}）`)
      sporeOwner.set(sporeId, '')
    }
    for (const identifyId of draft.identifyIds) {
      if (identifyOwner.has(identifyId)) throw new OrganizeError(`同一条鉴定留痕被重复分配到两条新条目（${identifyId}）`)
      identifyOwner.set(identifyId, '')
    }
  })

  const newRecords: FungusRecord[] = trimmed.map((draft) => ({
    ...origin,
    id: uid('rec'),
    code: draft.code,
    tempName: draft.tempName,
    pointId: draft.pointId,
    sourceId: origin.id,
    mergedInto: undefined
  }))

  trimmed.forEach((draft, index) => {
    for (const sporeId of draft.sporeIds) sporeOwner.set(sporeId, newRecords[index].id)
    for (const identifyId of draft.identifyIds) identifyOwner.set(identifyId, newRecords[index].id)
  })

  const nextSpores = ctx.spores.map((spore) =>
    sporeOwner.has(spore.id) ? { ...spore, recordId: sporeOwner.get(spore.id) as string } : spore
  )
  const nextIdentifies = ctx.identifies.map((log) =>
    identifyOwner.has(log.id) ? { ...log, recordId: identifyOwner.get(log.id) as string } : log
  )
  const nextRecords = [...ctx.records, ...newRecords]

  const problems = validateProposed({ records: nextRecords, spores: nextSpores, identifies: nextIdentifies, points: ctx.points })
  if (problems.length > 0) throw new OrganizeError(problems.join('；'))

  const log: OrganizeLog = {
    id: uid('org'),
    kind: 'split',
    at: new Date().toISOString(),
    originId: origin.id,
    originCode: origin.code,
    newIds: newRecords.map((record) => record.id),
    newCodes: newRecords.map((record) => record.code)
  }

  await db.transaction('rw', [db.records, db.spores, db.identifies, db.organizations], async () => {
    await db.records.bulkPut(newRecords)
    await db.spores.bulkPut(nextSpores.filter((spore) => sporeOwner.has(spore.id)))
    await db.identifies.bulkPut(nextIdentifies.filter((item) => identifyOwner.has(item.id)))
    await db.organizations.put(log)
  })

  return log
}
