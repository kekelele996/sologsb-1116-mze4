import type { FungusRecord, IdentifyLog, SporePrint } from './index'

/** 整理类型：merge 合并重复条目；split 拆分混采编号 */
export const CURATION_KINDS = ['merge', 'split'] as const
export type CurationKind = (typeof CURATION_KINDS)[number]

/** 单项关联数据（孢子印 / 鉴定留痕）在整理后的归属 */
export interface CurationAttachment {
  /** 孢子印或鉴定留痕自身 id */
  itemId: string
  kind: 'spore' | 'identify'
  /** 整理后所属条目 id（合并：主条目或原来源；拆分：某条新条目或原来源） */
  targetRecordId: string
  /** 整理前所属条目 id */
  originRecordId: string
  /** 摘要，用于留痕列表展示（如「白色印 / 12h」「Boletus sp.（中）」） */
  summary: string
}

/** 合并整理事件 */
export interface MergeEventData {
  kind: 'merge'
  /** 保留为主条目的记录 id */
  masterId: string
  /** 被合并归档的来源条目 id（按选择顺序） */
  sourceIds: string[]
  /**
   * 主条目每个形态字段最终采用哪条记录的值：字段名 -> 记录 id。
   * 未采用的观察仍可在来源归档快照中查阅。
   */
  fieldChoices: Record<string, string>
  attachments: CurationAttachment[]
}

/** 单条拆分产物（新条目） */
export interface SplitResultDraft {
  /** 新采集编号 */
  code: string
  /** 各形态字段值（克隆自来源后逐项可改） */
  fields: Omit<FungusRecord, 'id' | 'code' | 'status' | 'mergedIntoId' | 'splitFromId'>
  /** 该产物承接的孢子印 / 鉴定留痕；未列入的仍留在来源快照 */
  attachmentItemIds: string[]
}

/** 拆分整理事件 */
export interface SplitEventData {
  kind: 'split'
  /** 被拆分归档的来源条目 id */
  sourceId: string
  /** 拆分产物新记录 id（与产物编号、承接关系一一对应） */
  resultIds: string[]
  /** 各产物的新编号 */
  resultCodes: string[]
  /** 每个孢子印 / 鉴定留痕的去向（留在来源或转入某条新条目） */
  attachments: CurationAttachment[]
}

/** 记录整理事件（合并 / 拆分留痕，随 IndexedDB 持久化） */
export interface CurationEvent {
  id: string
  kind: CurationKind
  /** 操作时间 ISO 文本 */
  date: string
  /** 操作人（取当前账号下最后保存的采集人，可空） */
  operator: string
  data: MergeEventData | SplitEventData
  /** 操作前来源条目快照（原记录、孢子印、鉴定留痕均不改，仅用于追溯展示） */
  recordSnapshots: FungusRecord[]
  sporeSnapshots: SporePrint[]
  identifySnapshots: IdentifyLog[]
}
