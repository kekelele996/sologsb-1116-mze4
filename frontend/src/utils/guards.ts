import type {
  CurationAttachment,
  CurationEvent,
  CollectPoint,
  FungusRecord,
  IdentifyLog,
  SporePrint
} from '@/types'
import { TRAIT_FIELDS } from '@/utils/curation'

/** 整理前校验上下文：四张业务表 + 已发生的整理事件 */
export interface CurationContext {
  records: FungusRecord[]
  spores: SporePrint[]
  identifies: IdentifyLog[]
  points: CollectPoint[]
  events: CurationEvent[]
}

/** 安全校验失败：抛出后整笔事务回滚，原记录、孢子印、鉴定留痕均不改动 */
export class CurationGuardError extends Error {}

/* ---------------------------------- 整理计划入参 ---------------------------------- */

export interface MergePlanAttachment {
  itemId: string
  kind: 'spore' | 'identify'
  /** 转到主条目传 masterId；随来源快照保留传该来源条目 id */
  targetRecordId: string
}

export interface MergePlan {
  eventId: string
  date: string
  operator: string
  masterId: string
  sourceIds: string[]
  /** 形态字段 -> 采用哪条参与记录的值（必须逐项给出） */
  fieldChoices: Record<string, string>
  attachments: MergePlanAttachment[]
}

export interface SplitPlanResult {
  id: string
  code: string
  fields: Omit<FungusRecord, 'id' | 'code' | 'status' | 'mergedIntoId' | 'splitFromId'>
  /** 转入该产物的孢子印 / 鉴定留痕 id；未列入者留在来源快照 */
  attachmentItemIds: string[]
}

export interface SplitPlan {
  eventId: string
  date: string
  operator: string
  sourceId: string
  results: SplitPlanResult[]
}

/** 一份整理计划计算出的全部写入内容 */
export interface Preview {
  records: FungusRecord[]
  spores: SporePrint[]
  identifies: IdentifyLog[]
  event: CurationEvent
}

/* ---------------------------------- 通用不变量 ---------------------------------- */

/** 整理后整库体检：编号重复、关联缺失、来源互指/成环、事件与指针不一致都在这里拦下 */
export function assertHealthy(ctx: CurationContext): void {
  const recordMap = new Map(ctx.records.map((record) => [record.id, record]))
  const pointMap = new Map(ctx.points.map((point) => [point.id, point]))

  // 1. 活跃条目的采集编号不得重复（归档快照保留原编号，不参与查重）
  const seenCodes = new Map<string, string>()
  for (const record of ctx.records) {
    if (record.status !== 'active') continue
    const code = record.code.trim()
    if (!code) throw new CurationGuardError('存在采集编号为空的条目')
    const other = seenCodes.get(code)
    if (other && other !== record.id) {
      throw new CurationGuardError(`采集编号「${code}」重复`)
    }
    seenCodes.set(code, record.id)
  }

  // 2. 孢子印 / 鉴定留痕必须挂在真实存在的条目上（关联缺失即拦）
  for (const spore of ctx.spores) {
    if (!recordMap.has(spore.recordId)) {
      throw new CurationGuardError(`孢子印 ${spore.id} 关联的条目不存在（关联缺失）`)
    }
  }
  for (const log of ctx.identifies) {
    if (!recordMap.has(log.recordId)) {
      throw new CurationGuardError(`鉴定留痕 ${log.id} 关联的条目不存在（关联缺失）`)
    }
  }

  // 3. 条目引用的采集点必须存在（归档快照同样需要可追溯的采集点）
  for (const record of ctx.records) {
    if (!pointMap.has(record.pointId)) {
      throw new CurationGuardError(`条目「${record.code}」关联的采集点不存在（关联缺失）`)
    }
  }

  // 4. 合并指针不得自指、成环或断链（A→B 与 B→A 这类互指会被成环检测拦下）
  for (const record of ctx.records) {
    if (!record.mergedIntoId) continue
    if (record.mergedIntoId === record.id) {
      throw new CurationGuardError(`条目「${record.code}」的合并来源指向了自己（来源自指）`)
    }
    const visited = new Set<string>([record.id])
    let cursor = record.mergedIntoId
    while (cursor) {
      if (visited.has(cursor)) {
        throw new CurationGuardError('整理来源之间互相指向形成环路，已停止')
      }
      const target = recordMap.get(cursor)
      if (!target) {
        throw new CurationGuardError(`条目「${record.code}」合并去向的条目不存在（关联缺失）`)
      }
      visited.add(cursor)
      cursor = target.mergedIntoId ?? ''
    }
  }

  // 5. 拆分产物指针必须指回真实存在的来源
  for (const record of ctx.records) {
    if (record.splitFromId && !recordMap.has(record.splitFromId)) {
      throw new CurationGuardError(`条目「${record.code}」的拆分来源不存在（关联缺失）`)
    }
  }

  // 6. 整理事件与条目指针双向对账：事件里出现的关系必须与条目状态严格一致
  for (const event of ctx.events) {
    if (event.data.kind === 'merge') {
      const { masterId, sourceIds, fieldChoices, attachments } = event.data
      const master = recordMap.get(masterId)
      if (!master) throw new CurationGuardError('合并事件的主条目缺失，已停止')
      const participants = new Set([masterId, ...sourceIds])
      if (participants.size !== sourceIds.length + 1) {
        throw new CurationGuardError('合并事件的参与条目重复，已停止')
      }
      for (const sourceId of sourceIds) {
        const source = recordMap.get(sourceId)
        if (!source || source.status !== 'merged' || source.mergedIntoId !== masterId) {
          throw new CurationGuardError(`合并来源「${source?.code ?? sourceId}」状态与整理事件不一致`)
        }
      }
      for (const chosenId of Object.values(fieldChoices)) {
        if (!participants.has(chosenId)) {
          throw new CurationGuardError('合并采用的形态值不来自任一参与条目，已停止')
        }
      }
      checkAttachments(attachments, ctx, participants)
    } else {
      const { sourceId, resultIds, resultCodes, attachments } = event.data
      const source = recordMap.get(sourceId)
      if (!source || source.status !== 'split') {
        throw new CurationGuardError('拆分事件的来源条目缺失或状态不符，已停止')
      }
      if (resultIds.length < 2 || resultIds.length !== resultCodes.length) {
        throw new CurationGuardError('拆分事件至少需要两条产物且编号一一对应')
      }
      const resultSet = new Set<string>()
      resultIds.forEach((id, index) => {
        if (resultSet.has(id)) throw new CurationGuardError('拆分产物重复，已停止')
        resultSet.add(id)
        const result = recordMap.get(id)
        if (!result || result.status !== 'active' || result.splitFromId !== sourceId || result.code !== resultCodes[index]) {
          throw new CurationGuardError(`拆分产物「${resultCodes[index]}」状态与整理事件不一致`)
        }
      })
      checkAttachments(attachments, ctx, new Set([sourceId, ...resultIds]))
    }
  }
}

function checkAttachments(
  attachments: CurationAttachment[],
  ctx: CurationContext,
  allowedTargets: Set<string>
): void {
  const sporeMap = new Map(ctx.spores.map((spore) => [spore.id, spore]))
  const logMap = new Map(ctx.identifies.map((log) => [log.id, log]))
  for (const attachment of attachments) {
    const current =
      attachment.kind === 'spore' ? sporeMap.get(attachment.itemId) : logMap.get(attachment.itemId)
    if (!current) {
      throw new CurationGuardError('整理事件引用的孢子印 / 鉴定留痕已不存在（关联缺失）')
    }
    if (current.recordId !== attachment.targetRecordId) {
      throw new CurationGuardError('孢子印 / 鉴定留痕的实际归属与整理事件不一致')
    }
    if (!allowedTargets.has(attachment.targetRecordId)) {
      throw new CurationGuardError('孢子印 / 鉴定留痕被转到整理范围之外的条目，已停止')
    }
    if (!allowedTargets.has(attachment.originRecordId)) {
      throw new CurationGuardError('孢子印 / 鉴定留痕的原归属不在整理范围内，已停止')
    }
  }
}

/* ---------------------------------- 合并预演 ---------------------------------- */

export function sporeSummary(spore: SporePrint): string {
  return `孢子印 ${spore.color} · ${spore.hours}h · ${spore.observeDate}`
}

export function identifySummary(log: IdentifyLog): string {
  return `${log.conclusion}（${log.confidence}${log.needReview ? '，待复核' : ''}）· ${log.date}`
}

export function previewMerge(plan: MergePlan, ctx: CurationContext): Preview {
  const recordMap = new Map(ctx.records.map((record) => [record.id, record]))
  const master = recordMap.get(plan.masterId)
  if (!master) throw new CurationGuardError('所选主条目不存在或已被归档')
  const participants = [plan.masterId, ...plan.sourceIds]
  if (new Set(participants).size !== participants.length) {
    throw new CurationGuardError('合并参与条目有重复，请重新选择')
  }
  if (participants.length < 2) throw new CurationGuardError('请至少选择两条条目进行合并')
  for (const id of participants) {
    const record = recordMap.get(id)
    if (!record) throw new CurationGuardError('存在已被删除的参与条目（关联缺失）')
    if (record.status !== 'active') throw new CurationGuardError(`「${record.code}」已是归档快照，不能再次整理`)
  }
  const participantSet = new Set(participants)

  // 形态字段必须逐项选择，且取值只能来自参与条目
  for (const field of TRAIT_FIELDS) {
    const chosenId = plan.fieldChoices[field.key]
    if (!chosenId) throw new CurationGuardError(`形态字段「${field.label}」尚未选择采用值`)
    if (!participantSet.has(chosenId)) {
      throw new CurationGuardError(`形态字段「${field.label}」的采用值不来自所选条目`)
    }
  }

  // 孢子印 / 鉴定留痕去向：只能转到主条目，或留在原来源随快照保留
  const sporeMap = new Map(ctx.spores.map((spore) => [spore.id, spore]))
  const logMap = new Map(ctx.identifies.map((log) => [log.id, log]))
  const nextAttachments: CurationAttachment[] = []
  for (const item of plan.attachments) {
    const owner =
      item.kind === 'spore' ? sporeMap.get(item.itemId)?.recordId : logMap.get(item.itemId)?.recordId
    const entity = item.kind === 'spore' ? sporeMap.get(item.itemId) : logMap.get(item.itemId)
    if (!entity || !owner || !participantSet.has(owner)) {
      throw new CurationGuardError('存在不属于所选条目的孢子印 / 鉴定留痕')
    }
    if (item.targetRecordId !== plan.masterId && item.targetRecordId !== owner) {
      throw new CurationGuardError('孢子印 / 鉴定留痕只能转到主条目或留在原来源')
    }
    const row = entity as SporePrint | IdentifyLog
    nextAttachments.push({
      itemId: item.itemId,
      kind: item.kind,
      targetRecordId: item.targetRecordId,
      originRecordId: owner,
      summary: item.kind === 'spore' ? sporeSummary(row as SporePrint) : identifySummary(row as IdentifyLog)
    })
  }

  // 计算下一状态：主条目采用所选字段；来源条目原样归档
  const nextMaster: FungusRecord = { ...master }
  for (const field of TRAIT_FIELDS) {
    const from = recordMap.get(plan.fieldChoices[field.key])!
    ;(nextMaster as unknown as Record<string, string | number>)[field.key] = from[field.key]
  }
  if (!ctx.points.some((point) => point.id === nextMaster.pointId)) {
    throw new CurationGuardError('采用的采集点不存在（关联缺失）')
  }

  const sourceRecords = plan.sourceIds.map((id) => recordMap.get(id)!)
  const sourceSet = new Set(plan.sourceIds)
  const nextRecords = ctx.records.map((record) => {
    if (record.id === plan.masterId) return nextMaster
    if (sourceSet.has(record.id)) {
      return { ...record, status: 'merged' as const, mergedIntoId: plan.masterId }
    }
    return record
  })

  const movedItems = new Map(nextAttachments.map((item) => [item.itemId, item.targetRecordId]))
  const nextSpores = ctx.spores.map((spore) =>
    movedItems.has(spore.id) ? { ...spore, recordId: movedItems.get(spore.id)! } : spore
  )
  const nextIdentifies = ctx.identifies.map((log) =>
    movedItems.has(log.id) ? { ...log, recordId: movedItems.get(log.id)! } : log
  )

  const event: CurationEvent = {
    id: plan.eventId,
    kind: 'merge',
    date: plan.date,
    operator: plan.operator,
    data: {
      kind: 'merge',
      masterId: plan.masterId,
      sourceIds: [...plan.sourceIds],
      fieldChoices: { ...plan.fieldChoices },
      attachments: nextAttachments
    },
    recordSnapshots: [master, ...sourceRecords].map((record) => ({ ...record })),
    sporeSnapshots: ctx.spores
      .filter((spore) => participantSet.has(spore.recordId))
      .map((spore) => ({ ...spore })),
    identifySnapshots: ctx.identifies
      .filter((log) => participantSet.has(log.recordId))
      .map((log) => ({ ...log }))
  }

  const nextCtx: CurationContext = {
    ...ctx,
    records: nextRecords,
    spores: nextSpores,
    identifies: nextIdentifies,
    events: [...ctx.events, event]
  }
  assertHealthy(nextCtx)
  return { records: nextRecords, spores: nextSpores, identifies: nextIdentifies, event }
}

/* ---------------------------------- 拆分预演 ---------------------------------- */

export function previewSplit(plan: SplitPlan, ctx: CurationContext): Preview {
  const recordMap = new Map(ctx.records.map((record) => [record.id, record]))
  const source = recordMap.get(plan.sourceId)
  if (!source) throw new CurationGuardError('被拆分的来源条目不存在')
  if (source.status !== 'active') throw new CurationGuardError(`「${source.code}」已是归档快照，不能再次整理`)
  if (plan.results.length < 2) throw new CurationGuardError('拆分至少要生成两条独立条目')

  const idSet = new Set<string>()
  const codeSet = new Set<string>()
  for (const result of plan.results) {
    const code = result.code.trim()
    if (!code) throw new CurationGuardError('每条拆分产物都必须填写新的采集编号')
    if (code === source.code) {
      throw new CurationGuardError(`新编号不能沿用原编号「${source.code}」，原编号需留作来源`)
    }
    if (codeSet.has(code)) throw new CurationGuardError(`拆分产物编号「${code}」重复`)
    const clash = ctx.records.find((record) => record.status === 'active' && record.code === code)
    if (clash) throw new CurationGuardError(`采集编号「${code}」已被现有条目占用`)
    if (idSet.has(result.id)) throw new CurationGuardError('拆分产物 id 重复')
    idSet.add(result.id)
    codeSet.add(code)
    if (ctx.records.some((record) => record.id === result.id)) {
      throw new CurationGuardError('拆分产物与现有条目 id 冲突')
    }
    if (!ctx.points.some((point) => point.id === result.fields.pointId)) {
      throw new CurationGuardError(`产物「${code}」采用的采集点不存在（关联缺失）`)
    }
  }

  const ownedSpores = new Set(ctx.spores.filter((spore) => spore.recordId === plan.sourceId).map((spore) => spore.id))
  const ownedLogs = new Set(
    ctx.identifies.filter((log) => log.recordId === plan.sourceId).map((log) => log.id)
  )
  const nextAttachments: CurationAttachment[] = []
  for (const result of plan.results) {
    for (const itemId of result.attachmentItemIds) {
      const isSpore = ownedSpores.has(itemId)
      const isLog = ownedLogs.has(itemId)
      if (!isSpore && !isLog) {
        throw new CurationGuardError(`产物「${result.code}」承接了来源之外的孢子印 / 鉴定留痕`)
      }
      const entity = isSpore
        ? ctx.spores.find((spore) => spore.id === itemId)!
        : ctx.identifies.find((log) => log.id === itemId)!
      nextAttachments.push({
        itemId,
        kind: isSpore ? 'spore' : 'identify',
        targetRecordId: result.id,
        originRecordId: plan.sourceId,
        summary: isSpore ? sporeSummary(entity as SporePrint) : identifySummary(entity as IdentifyLog)
      })
    }
  }

  // 同一份孢子印 / 鉴定留痕不得被两条产物同时承接
  if (new Set(nextAttachments.map((item) => item.itemId)).size !== nextAttachments.length) {
    throw new CurationGuardError('同一份孢子印 / 鉴定留痕被重复分配给多条产物')
  }

  const newRecords: FungusRecord[] = plan.results.map((result) => ({
    id: result.id,
    code: result.code.trim(),
    ...result.fields,
    status: 'active',
    splitFromId: plan.sourceId
  }))

  const nextSource: FungusRecord = { ...source, status: 'split' }
  const nextRecords = ctx.records.map((record) => (record.id === plan.sourceId ? nextSource : record))
  nextRecords.push(...newRecords)

  const movedItems = new Map(nextAttachments.map((item) => [item.itemId, item.targetRecordId]))
  const nextSpores = ctx.spores.map((spore) =>
    movedItems.has(spore.id) ? { ...spore, recordId: movedItems.get(spore.id)! } : spore
  )
  const nextIdentifies = ctx.identifies.map((log) =>
    movedItems.has(log.id) ? { ...log, recordId: movedItems.get(log.id)! } : log
  )

  const event: CurationEvent = {
    id: plan.eventId,
    kind: 'split',
    date: plan.date,
    operator: plan.operator,
    data: {
      kind: 'split',
      sourceId: plan.sourceId,
      resultIds: plan.results.map((result) => result.id),
      resultCodes: plan.results.map((result) => result.code.trim()),
      attachments: nextAttachments
    },
    recordSnapshots: [{ ...source }],
    sporeSnapshots: ctx.spores.filter((spore) => ownedSpores.has(spore.id)).map((spore) => ({ ...spore })),
    identifySnapshots: ctx.identifies.filter((log) => ownedLogs.has(log.id)).map((log) => ({ ...log }))
  }

  assertHealthy({ ...ctx, records: nextRecords, spores: nextSpores, identifies: nextIdentifies, events: [...ctx.events, event] })
  return { records: nextRecords, spores: nextSpores, identifies: nextIdentifies, event }
}

/** 删除前检查：整理链路上的条目（主条目 / 拆分产物 / 归档快照）不允许直接删除，以免破坏追溯 */
export function removalBlocked(record: FungusRecord, ctx: CurationContext): string | null {
  if (record.status !== 'active') return '归档快照是整理追溯的一部分，不能删除'
  if (ctx.records.some((item) => item.mergedIntoId === record.id)) {
    return '该条目是合并主条目，仍有归档来源指向它，不能删除'
  }
  for (const event of ctx.events) {
    if (event.data.kind === 'split' && event.data.resultIds.includes(record.id)) {
      return '该条目是拆分产物，来源事件仍在追溯链上，不能删除'
    }
    if (event.data.kind === 'merge' && event.data.masterId === record.id) {
      return '该条目是合并主条目，整理事件仍在追溯链上，不能删除'
    }
  }
  return null
}
