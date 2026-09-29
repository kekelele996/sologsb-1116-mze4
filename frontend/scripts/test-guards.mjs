/**
 * 整理安全校验（guards.ts）的独立测试：
 * 正常合并 / 正常拆分 / 编号重复 / 来源互指 / 关联缺失 / 归档不查重 / 非法去向 / 删除保护。
 * 运行：node scripts/test-guards.mjs（由 esbuild 即时转译）
 */
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'

const result = await build({
  entryPoints: ['src/utils/guards.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  alias: { '@': new URL('../src', import.meta.url).pathname }
})
const outFile = new URL('../node_modules/.guards-test.mjs', import.meta.url)
writeFileSync(outFile, result.outputFiles[0].text)
const mod = await import(outFile.href)
const { previewMerge, previewSplit, assertHealthy, removalBlocked, CurationGuardError } = mod

let passed = 0
let failed = 0
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failed += 1
    console.error(`  ✗ ${name}: ${error.message}`)
  }
}
function expectThrow(name, fn, fragment) {
  try {
    fn()
    failed += 1
    console.error(`  ✗ ${name}: 应当抛出错误但成功了`)
  } catch (error) {
    if (fragment && !error.message.includes(fragment)) {
      failed += 1
      console.error(`  ✗ ${name}: 错误信息不含「${fragment}」，实际：${error.message}`)
      return
    }
    passed += 1
    console.log(`  ✓ ${name}`)
  }
}

/* ---------------- 构造测试数据 ---------------- */
function record(id, code, extra = {}) {
  return {
    id,
    code,
    tempName: `菌-${code}`,
    fruitBodyCount: 1,
    pointId: 'pt1',
    capDiameter: 5,
    capShape: '平展',
    capMargin: '全缘',
    capTexture: '光滑',
    fleshThickness: 1,
    fleshReaction: '不变色',
    attachment: '直生',
    gillDensity: '中等',
    stipeLength: 5,
    stipeDiameter: 1,
    ring: '无菌环',
    volva: '无菌托',
    odor: '',
    hostTree: '栎',
    collectDate: '2026-09-01',
    collector: '甲',
    note: '',
    status: 'active',
    ...extra
  }
}
const spore = (id, recordId, color = '白色') => ({
  id, recordId, color, shape: '圆', hours: 8, observeDate: '2026-09-02', moisture: '干'
})
const log = (id, recordId, conclusion = 'Agaricus sp.') => ({
  id, recordId, conclusion, basis: '形态特征', referenceBook: '', referencePage: '',
  confidence: '中', needReview: false, reviewer: '', date: '2026-09-02'
})
const baseCtx = () => ({
  records: [
    record('r1', 'BHS-001', { capShape: '半球形', attachment: '直生' }),
    record('r2', 'BHS-002', { capShape: '平展', attachment: '弯生' }),
    record('r3', 'BHS-003', { capShape: '漏斗形' }),
    record('arch1', 'BHS-001', { status: 'merged', mergedIntoId: 'r1' })
  ],
  spores: [spore('s1', 'r1'), spore('s2', 'r2'), spore('s3', 'arch1')],
  identifies: [log('l1', 'r1'), log('l2', 'r2')],
  points: [{
    id: 'pt1', name: '样线', longitude: 115, latitude: 39, altitude: 1000,
    vegetation: '针阔混交林', substrate: '落叶层', companionTrees: '', collectDate: '2026-09-01', collector: '甲'
  }],
  events: [
    {
      id: 'old', kind: 'merge', date: '2026-09-01', operator: '',
      data: { kind: 'merge', masterId: 'r1', sourceIds: ['arch1'], fieldChoices: {}, attachments: [{ itemId: 's3', kind: 'spore', targetRecordId: 'arch1', originRecordId: 'arch1', summary: '' }] },
      recordSnapshots: [], sporeSnapshots: [], identifySnapshots: []
    }
  ]
})
const FIELD_KEYS = [
  'tempName', 'fruitBodyCount', 'pointId', 'capDiameter', 'capShape', 'capMargin', 'capTexture',
  'fleshThickness', 'fleshReaction', 'attachment', 'gillDensity', 'stipeLength', 'stipeDiameter',
  'ring', 'volva', 'odor', 'hostTree', 'collectDate', 'collector', 'note'
]
const choices = (id) => Object.fromEntries(FIELD_KEYS.map((key) => [key, id]))
const mergePlan = (over = {}) => ({
  eventId: 'ev1', date: '2026-09-03', operator: '甲',
  masterId: 'r1', sourceIds: ['r2'],
  fieldChoices: choices('r1'),
  attachments: [
    { itemId: 's1', kind: 'spore', targetRecordId: 'r1' },
    { itemId: 's2', kind: 'spore', targetRecordId: 'r1' },
    { itemId: 'l1', kind: 'identify', targetRecordId: 'r1' },
    { itemId: 'l2', kind: 'identify', targetRecordId: 'r2' }
  ],
  ...over
})

console.log('合并：')
check('正常合并成功，主条目采用 r2 的冲突值', () => {
  const preview = previewMerge(mergePlan({ fieldChoices: { ...choices('r1'), capShape: 'r2' } }), baseCtx())
  const master = preview.records.find((r) => r.id === 'r1')
  const source = preview.records.find((r) => r.id === 'r2')
  if (master.capShape !== '平展') throw new Error('主条目 capShape 应为平展')
  if (source.status !== 'merged' || source.mergedIntoId !== 'r1') throw new Error('r2 应归档指向 r1')
  if (preview.spores.find((s) => s.id === 's2').recordId !== 'r1') throw new Error('s2 应转到主条目')
  if (preview.identifies.find((l) => l.id === 'l2').recordId !== 'r2') throw new Error('l2 应留在来源')
  if (preview.event.data.kind !== 'merge') throw new Error('事件类型应为 merge')
})

check('未采用观察保留在来源快照（r2 原值不改）', () => {
  const preview = previewMerge(mergePlan(), baseCtx())
  const snapshot = preview.event.recordSnapshots.find((r) => r.id === 'r2')
  if (snapshot.capShape !== '平展') throw new Error('快照应为原值 平展')
  const source = preview.records.find((r) => r.id === 'r2')
  if (source.capShape !== '平展') throw new Error('归档来源字段必须原样保留')
})

expectThrow('合并后主条目编号与第三条活跃条目重复时停止', () => {
  const ctx = baseCtx()
  // 让 r3 与主条目同编号（模拟脏数据）
  ctx.records[2] = record('r3', 'BHS-001')
  previewMerge(mergePlan(), ctx)
}, '采集编号')

expectThrow('归档条目不能再次合并', () => {
  previewMerge(mergePlan({ masterId: 'r1', sourceIds: ['arch1'] }), baseCtx())
}, '归档快照')

expectThrow('只有一条参与条目时停止', () => {
  previewMerge(mergePlan({ sourceIds: [] }), baseCtx())
}, '至少选择两条')

expectThrow('字段选择了参与范围外的条目时停止', () => {
  previewMerge(mergePlan({ fieldChoices: { ...choices('r1'), capShape: 'r3' } }), baseCtx())
}, '不来自所选条目')

expectThrow('孢子印转到范围外条目时停止', () => {
  previewMerge(mergePlan({
    attachments: [
      { itemId: 's1', kind: 'spore', targetRecordId: 'r3' },
      { itemId: 's2', kind: 'spore', targetRecordId: 'r1' },
      { itemId: 'l1', kind: 'identify', targetRecordId: 'r1' },
      { itemId: 'l2', kind: 'identify', targetRecordId: 'r2' }
    ]
  }), baseCtx())
}, '只能转到主条目或留在原来源')

expectThrow('来源合并指针成环（互指）时停止', () => {
  const ctx = baseCtx()
  // 预置 r2 已合并到 r1、r1 又指向 r2 的互指脏数据
  ctx.records[0] = record('r1', 'BHS-001', { mergedIntoId: 'r2', status: 'merged' })
  ctx.records[1] = record('r2', 'BHS-002', { mergedIntoId: 'r1', status: 'merged' })
  assertHealthy(ctx)
}, '环路')

expectThrow('孢子印指向不存在条目（关联缺失）时停止', () => {
  const ctx = baseCtx()
  ctx.spores[0] = spore('s1', 'ghost')
  assertHealthy(ctx)
}, '关联缺失')

expectThrow('条目引用不存在采集点时停止', () => {
  const ctx = baseCtx()
  ctx.records[0] = record('r1', 'BHS-001', { pointId: 'ptx' })
  assertHealthy(ctx)
}, '采集点不存在')

expectThrow('合并事件主条目缺失时停止', () => {
  const ctx = baseCtx()
  ctx.events = [{
    id: 'x', kind: 'merge', date: '2026-09-01', operator: '',
    data: { kind: 'merge', masterId: 'ghost', sourceIds: [], fieldChoices: {}, attachments: [] },
    recordSnapshots: [], sporeSnapshots: [], identifySnapshots: []
  }]
  assertHealthy(ctx)
}, '主条目缺失')

console.log('拆分：')
const splitPlan = (over = {}) => {
  const fields = (capShape) => {
    const r = record('x', 'x', { capShape })
    delete r.id; delete r.code; delete r.status; delete r.mergedIntoId; delete r.splitFromId
    return r
  }
  return {
    eventId: 'ev2', date: '2026-09-03', operator: '甲', sourceId: 'r3',
    results: [
      { id: 'n1', code: 'BHS-003-A', fields: fields('漏斗形'), attachmentItemIds: [] },
      { id: 'n2', code: 'BHS-003-B', fields: fields('中凹'), attachmentItemIds: [] }
    ],
    ...over
  }
}

check('正常拆分生成两条新编号，原条目转 split 快照', () => {
  const preview = previewSplit(splitPlan(), baseCtx())
  const source = preview.records.find((r) => r.id === 'r3')
  if (source.status !== 'split') throw new Error('来源应为 split')
  const n1 = preview.records.find((r) => r.id === 'n1')
  const n2 = preview.records.find((r) => r.id === 'n2')
  if (!n1 || !n2) throw new Error('两条产物都应存在')
  if (n1.splitFromId !== 'r3' || n2.splitFromId !== 'r3') throw new Error('产物应指回来源')
  if (n2.capShape !== '中凹') throw new Error('产物字段应独立')
  if (preview.event.data.kind !== 'split' || preview.event.data.resultCodes.length !== 2) throw new Error('事件记录应有两条产物')
})

check('拆分时孢子印/鉴定可转入指定产物', () => {
  const ctx = baseCtx()
  ctx.spores.push(spore('s9', 'r3', '黑褐'))
  ctx.identifies.push(log('l9', 'r3', 'Russula sp.'))
  const plan = splitPlan({
    results: [
      { id: 'n1', code: 'BHS-003-A', fields: splitPlan().results[0].fields, attachmentItemIds: ['s9'] },
      { id: 'n2', code: 'BHS-003-B', fields: splitPlan().results[1].fields, attachmentItemIds: ['l9'] }
    ]
  })
  const preview = previewSplit(plan, ctx)
  if (preview.spores.find((s) => s.id === 's9').recordId !== 'n1') throw new Error('s9 应转入 n1')
  if (preview.identifies.find((l) => l.id === 'l9').recordId !== 'n2') throw new Error('l9 应转入 n2')
})

expectThrow('拆分少于两条产物时停止', () => {
  const plan = splitPlan()
  plan.results = plan.results.slice(0, 1)
  previewSplit(plan, baseCtx())
}, '至少要生成两条')

expectThrow('新编号沿用原编号时停止', () => {
  const plan = splitPlan()
  plan.results[0].code = 'BHS-003'
  previewSplit(plan, baseCtx())
}, '不能沿用原编号')

expectThrow('两条新编号互相重复时停止', () => {
  const plan = splitPlan()
  plan.results[1].code = 'BHS-003-A'
  previewSplit(plan, baseCtx())
}, '重复')

expectThrow('新编号与现有活跃条目冲突时停止', () => {
  const plan = splitPlan()
  plan.results[0].code = 'BHS-001'
  previewSplit(plan, baseCtx())
}, '已被现有条目占用')

expectThrow('产物引用不存在采集点时停止', () => {
  const plan = splitPlan()
  plan.results[0].fields.pointId = 'ptx'
  previewSplit(plan, baseCtx())
}, '采集点不存在')

expectThrow('同一份观察分配给两条产物时停止', () => {
  const ctx = baseCtx()
  ctx.spores.push(spore('s9', 'r3'))
  const plan = splitPlan()
  plan.results[0].attachmentItemIds = ['s9']
  plan.results[1].attachmentItemIds = ['s9']
  previewSplit(plan, ctx)
}, '重复分配')

expectThrow('归档快照不能拆分', () => {
  const plan = splitPlan({ sourceId: 'arch1' })
  previewSplit(plan, baseCtx())
}, '归档快照')

console.log('删除保护：')
check('正常条目可删除', () => {
  const ctx = baseCtx()
  const blocked = removalBlocked(ctx.records[2], ctx) // r3 无整理关系
  if (blocked) throw new Error(`不应被拦：${blocked}`)
})
expectThrow('归档快照不可删除', () => {
  const ctx = baseCtx()
  const blocked = removalBlocked(ctx.records[3], ctx)
  if (blocked) throw new Error(blocked)
}, '归档快照')
expectThrow('合并主条目不可删除', () => {
  const ctx = baseCtx()
  const blocked = removalBlocked(ctx.records[0], ctx)
  if (blocked) throw new Error(blocked)
}, '合并主条目')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
