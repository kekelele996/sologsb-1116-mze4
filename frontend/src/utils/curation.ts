import type { FungusRecord } from '@/types'

/** 形态字段类型：enum 下拉 / number 数字 / text 文本 */
export type FieldKind = 'enum' | 'number' | 'text'

/** 参与整理（合并取舍 / 拆分编辑）的字段：不含 id、编号与整理状态字段 */
export type EditableTraitKey = Exclude<
  keyof FungusRecord,
  'id' | 'code' | 'status' | 'mergedIntoId' | 'splitFromId'
>

export interface TraitFieldMeta {
  /** FungusRecord 字段名 */
  key: EditableTraitKey
  label: string
  kind: FieldKind
  /** enum 字段的可选值 */
  options?: readonly string[]
  /** 数值单位（仅展示用，不参与存储） */
  unit?: string
  /** 所属分区（拆分表单分组） */
  group: 'cap' | 'flesh' | 'gill' | 'stipe' | 'eco' | 'base'
  /** 数字字段步进 */
  step?: number
  min?: number
}

/** 参与合并逐项取舍 / 拆分逐字段编辑的形态字段（id、编号、状态等整理字段不在此列） */
export const TRAIT_FIELDS: TraitFieldMeta[] = [
  { key: 'tempName', label: '暂定名', kind: 'text', group: 'base' },
  { key: 'fruitBodyCount', label: '子实体数量', kind: 'number', group: 'base', min: 1, step: 1 },
  { key: 'pointId', label: '采集点', kind: 'enum', group: 'base' },
  { key: 'capDiameter', label: '菌盖直径', kind: 'number', unit: 'cm', group: 'cap', min: 0, step: 0.5 },
  { key: 'capShape', label: '菌盖形状', kind: 'enum', group: 'cap', options: ['半球形', '平展', '中凹', '漏斗形', '钟形'] },
  { key: 'capMargin', label: '菌盖边缘', kind: 'enum', group: 'cap', options: ['全缘', '内卷', '波状', '开裂', '附着菌幕残片'] },
  { key: 'capTexture', label: '表面质地', kind: 'enum', group: 'cap', options: ['光滑', '绒状', '鳞片状', '粘滑', '龟裂'] },
  { key: 'fleshThickness', label: '菌肉厚度', kind: 'number', unit: 'cm', group: 'flesh', min: 0, step: 0.1 },
  {
    key: 'fleshReaction',
    label: '变色反应',
    kind: 'enum',
    group: 'flesh',
    options: ['不变色', '缓慢变蓝', '迅速变蓝', '变红', '变褐', '变黑']
  },
  { key: 'attachment', label: '着生方式', kind: 'enum', group: 'gill', options: ['离生', '弯生', '直生', '延生'] },
  { key: 'gillDensity', label: '菌褶密度', kind: 'enum', group: 'gill', options: ['稀疏', '中等', '密集'] },
  { key: 'stipeLength', label: '菌柄长度', kind: 'number', unit: 'cm', group: 'stipe', min: 0, step: 0.5 },
  { key: 'stipeDiameter', label: '菌柄直径', kind: 'number', unit: 'cm', group: 'stipe', min: 0, step: 0.1 },
  { key: 'ring', label: '菌环', kind: 'enum', group: 'stipe', options: ['无菌环', '膜质菌环', '蛛网状', '易脱落'] },
  { key: 'volva', label: '菌托', kind: 'enum', group: 'stipe', options: ['无菌托', '杯状菌托', '鳞片状菌托', '苞状菌托'] },
  { key: 'odor', label: '气味', kind: 'text', group: 'eco' },
  { key: 'hostTree', label: '关联树种', kind: 'text', group: 'eco' },
  { key: 'collectDate', label: '采集日期', kind: 'text', group: 'eco' },
  { key: 'collector', label: '采集人', kind: 'text', group: 'eco' },
  { key: 'note', label: '现场备注', kind: 'text', group: 'eco' }
]

export const TRAIT_FIELD_MAP: Record<string, TraitFieldMeta> = Object.fromEntries(
  TRAIT_FIELDS.map((field) => [field.key, field])
)

export const FIELD_GROUPS: { key: TraitFieldMeta['group']; title: string }[] = [
  { key: 'base', title: '基本信息' },
  { key: 'cap', title: '菌盖' },
  { key: 'flesh', title: '菌肉' },
  { key: 'gill', title: '菌褶 / 菌管' },
  { key: 'stipe', title: '菌柄 / 菌环菌托' },
  { key: 'eco', title: '气味与生境' }
]

/** 形态字段原值（来自参与整理的某条记录） */
export type TraitValue = string | number

/** 读取字段值 */
export function getTrait(record: FungusRecord, key: string): TraitValue {
  return record[key as keyof FungusRecord] as TraitValue
}

/** 带单位的字段展示文本 */
export function formatTrait(meta: TraitFieldMeta, value: TraitValue): string {
  if (value === '' || value === null || value === undefined) return '—'
  return meta.unit ? `${value} ${meta.unit}` : String(value)
}

/** 是否为活跃条目（参与图谱、对比、候选排序的唯一口径） */
export function isActive(record: FungusRecord): boolean {
  return (record.status ?? 'active') === 'active'
}
