/** 整理方式：合并两条重复记录 / 把一条混装记录拆成多条 */
export type OrganizeKind = 'merge' | 'split'

/** 合并时冲突形态值的取值来源：主条目 或 来源快照 */
export type FieldPick = 'main' | 'source'

/**
 * OrganizeLog 整理留痕。
 * 每次合并 / 拆分都落一条，跨浏览器长期保留，供图谱、详情页与「记录整理」页追溯。
 */
export interface OrganizeLog {
  id: string
  kind: OrganizeKind
  /** 整理时间（ISO 字符串） */
  at: string
  /* ---- 合并 ---- */
  /** 主条目 id（保留并继续补全的那条） */
  mainId?: string
  mainCode?: string
  /** 来源快照 id（被并入、保留观察留痕的那条） */
  sourceId?: string
  sourceCode?: string
  /** 冲突字段取值选择：字段名 -> 采用主条目还是来源条目 */
  chosen?: Record<string, FieldPick>
  /** 转到主条目的孢子印 id */
  transferredSporeIds?: string[]
  /** 转到主条目的鉴定留痕 id */
  transferredIdentifyIds?: string[]
  /* ---- 拆分 ---- */
  /** 被拆分的原记录 id（保留原编号与字段作为来源） */
  originId?: string
  originCode?: string
  /** 拆分生成的新条目 id */
  newIds?: string[]
  newCodes?: string[]
}
