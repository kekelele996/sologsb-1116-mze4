<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { FieldPick, FungusRecord, SporePrint } from '@/types'
import SporePrintSwatch from '@/components/common/SporePrintSwatch.vue'
import { useStore } from '@/hooks/usePersistentStore'
import { recordStore } from '@/stores/recordStore'
import { sporeStore } from '@/stores/sporeStore'
import { identifyStore } from '@/stores/identifyStore'
import { pointStore } from '@/stores/pointStore'
import { organizeStore } from '@/stores/organizeStore'
import {
  OrganizeError,
  applyMerge,
  applySplit,
  conflictFields,
  fieldDisplay,
  type SplitDraft
} from '@/utils/organize'

const route = useRoute()
const router = useRouter()
const recordState = useStore(recordStore)
const sporeState = useStore(sporeStore)
const identifyState = useStore(identifyStore)
const pointState = useStore(pointStore)
const organizeState = useStore(organizeStore)

const mode = ref<'merge' | 'split'>('merge')

/* ================= 合并 ================= */
const mergeMainId = ref('')
const mergeSourceId = ref('')
const chosen = reactive<Record<string, FieldPick>>({})
const transferSpore = reactive<Record<string, boolean>>({})
const transferIdentify = reactive<Record<string, boolean>>({})

const mergeMain = computed(() => recordState.records.find((r) => r.id === mergeMainId.value) ?? null)
const mergeSource = computed(() => recordState.records.find((r) => r.id === mergeSourceId.value) ?? null)
const mergeConflicts = computed(() =>
  mergeMain.value && mergeSource.value ? conflictFields(mergeMain.value, mergeSource.value) : []
)

const mainSpores = computed(() => sporeState.spores.filter((s) => s.recordId === mergeMainId.value))
const sourceSpores = computed(() => sporeState.spores.filter((s) => s.recordId === mergeSourceId.value))
const mainIdentifies = computed(() => identifyState.logs.filter((i) => i.recordId === mergeMainId.value))
const sourceIdentifies = computed(() => identifyState.logs.filter((i) => i.recordId === mergeSourceId.value))

watch(
  () => [mergeMainId.value, mergeSourceId.value],
  () => {
    for (const key of Object.keys(chosen)) delete chosen[key]
    for (const key of Object.keys(transferSpore)) delete transferSpore[key]
    for (const key of Object.keys(transferIdentify)) delete transferIdentify[key]
    if (!mergeMain.value || !mergeSource.value) return
    for (const field of conflictFields(mergeMain.value, mergeSource.value)) {
      chosen[field.key] = 'main'
    }
    // 默认把来源的孢子印与鉴定留痕全部转到主条目（可逐项取消，取消即随来源快照保留）
    for (const spore of sourceSpores.value) transferSpore[spore.id] = true
    for (const log of sourceIdentifies.value) transferIdentify[log.id] = true
  }
)

function swapMerge(): void {
  const tmp = mergeMainId.value
  mergeMainId.value = mergeSourceId.value
  mergeSourceId.value = tmp
}

function setAllSporeTransfer(value: boolean): void {
  for (const spore of sourceSpores.value) transferSpore[spore.id] = value
}
function setAllIdentifyTransfer(value: boolean): void {
  for (const log of sourceIdentifies.value) transferIdentify[log.id] = value
}

async function doMerge(): Promise<void> {
  if (!mergeMain.value || !mergeSource.value) {
    ElMessage.warning('请先选择主条目与来源条目')
    return
  }
  const transferredSporeIds = sourceSpores.value.filter((s) => transferSpore[s.id]).map((s) => s.id)
  const transferredIdentifyIds = sourceIdentifies.value.filter((i) => transferIdentify[i.id]).map((i) => i.id)
  try {
    await applyMerge(
      {
        main: mergeMain.value,
        source: mergeSource.value,
        chosen: { ...chosen },
        transferredSporeIds,
        transferredIdentifyIds
      },
      {
        records: recordState.records,
        spores: sporeState.spores,
        identifies: identifyState.logs,
        points: pointState.points
      }
    )
  } catch (err) {
    ElMessage.error(err instanceof OrganizeError ? err.message : '合并失败，原记录未改动')
    return
  }
  ElMessage.success(`已合并：主条目 ${mergeMain.value.code}，来源快照 ${mergeSource.value.code} 已保留`)
  await Promise.all([
    recordStore.getState().hydrate(),
    sporeStore.getState().hydrate(),
    identifyStore.getState().hydrate(),
    organizeStore.getState().hydrate()
  ])
  mergeMainId.value = ''
  mergeSourceId.value = ''
}

/* ================= 拆分 ================= */
const splitOriginId = ref('')
const splitDrafts = reactive<SplitDraft[]>([])
const sporeTarget = reactive<Record<string, string>>({})
const identifyTarget = reactive<Record<string, string>>({})

const splitOrigin = computed(() => recordState.records.find((r) => r.id === splitOriginId.value) ?? null)
const originSpores = computed(() => sporeState.spores.filter((s) => s.recordId === splitOriginId.value))
const originIdentifies = computed(() => identifyState.logs.filter((i) => i.recordId === splitOriginId.value))

function suggestCodes(origin: FungusRecord): string[] {
  const existing = new Set(recordState.records.map((r) => r.code))
  const suffix = '甲乙丙丁戊己庚辛壬癸'
  const codes: string[] = []
  for (let i = 0; i < 2; i++) {
    let candidate = `${origin.code}-${suffix[i]}`
    let n = 2
    while (existing.has(candidate) || codes.includes(candidate)) {
      candidate = `${origin.code}-${suffix[i]}${n}`
      n++
    }
    codes.push(candidate)
  }
  return codes
}

watch(
  () => splitOriginId.value,
  () => {
    splitDrafts.splice(0, splitDrafts.length)
    for (const key of Object.keys(sporeTarget)) delete sporeTarget[key]
    for (const key of Object.keys(identifyTarget)) delete identifyTarget[key]
    if (!splitOrigin.value) return
    const codes = suggestCodes(splitOrigin.value)
    for (let i = 0; i < 2; i++) {
      splitDrafts.push({
        code: codes[i],
        tempName: splitOrigin.value.tempName,
        pointId: splitOrigin.value.pointId,
        sporeIds: [],
        identifyIds: []
      })
    }
    for (const spore of originSpores.value) sporeTarget[spore.id] = 'origin'
    for (const log of originIdentifies.value) identifyTarget[log.id] = 'origin'
  }
)

function addDraft(): void {
  if (splitDrafts.length >= 6) {
    ElMessage.info('最多拆分为 6 条')
    return
  }
  splitDrafts.push({ code: '', tempName: '', pointId: splitOrigin.value?.pointId ?? '', sporeIds: [], identifyIds: [] })
}

function removeDraft(index: number): void {
  if (splitDrafts.length <= 2) {
    ElMessage.warning('至少保留 2 条独立条目')
    return
  }
  const removed = `d${index}`
  for (const key of Object.keys(sporeTarget)) if (sporeTarget[key] === removed) sporeTarget[key] = 'origin'
  for (const key of Object.keys(identifyTarget)) if (identifyTarget[key] === removed) identifyTarget[key] = 'origin'
  splitDrafts.splice(index, 1)
}

function draftLabel(index: number): string {
  const draft = splitDrafts[index]
  return draft.code.trim() || `新条目 ${index + 1}`
}

async function doSplit(): Promise<void> {
  if (!splitOrigin.value) {
    ElMessage.warning('请先选择要拆分的原记录')
    return
  }
  const drafts: SplitDraft[] = splitDrafts.map((_, index) => ({
    ...splitDrafts[index],
    sporeIds: Object.entries(sporeTarget)
      .filter(([, target]) => target === `d${index}`)
      .map(([id]) => id),
    identifyIds: Object.entries(identifyTarget)
      .filter(([, target]) => target === `d${index}`)
      .map(([id]) => id)
  }))
  try {
    await applySplit(splitOrigin.value, drafts, {
      records: recordState.records,
      spores: sporeState.spores,
      identifies: identifyState.logs,
      points: pointState.points
    })
  } catch (err) {
    ElMessage.error(err instanceof OrganizeError ? err.message : '拆分失败，原记录未改动')
    return
  }
  ElMessage.success(`已把 ${splitOrigin.value.code} 拆分为 ${drafts.length} 条独立条目，原编号与字段保留为来源`)
  await Promise.all([
    recordStore.getState().hydrate(),
    sporeStore.getState().hydrate(),
    identifyStore.getState().hydrate(),
    organizeStore.getState().hydrate()
  ])
  splitOriginId.value = ''
}

/* ================= 历史 ================= */
function sporeCaption(spore: SporePrint): string {
  return `${spore.color} · ${spore.hours}h · ${spore.observeDate}`
}

/* ================= 入口预选 ================= */
const routeQuery = route.query
if (routeQuery.main) {
  mode.value = 'merge'
  mergeMainId.value = String(routeQuery.main)
}
if (routeQuery.source) mergeSourceId.value = String(routeQuery.source)
if (routeQuery.split) {
  mode.value = 'split'
  splitOriginId.value = String(routeQuery.split)
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">记录整理</h2>
        <p class="page-sub">
          野外登记重复建条时合并两条记录（冲突形态值逐项选择，孢子印与鉴定留痕指定归属，未采用的随来源快照保留）；
          一个编号混装两种菌时拆成多条独立条目（每条新编号，原编号与字段留作来源）。整理前自动校验编号重复、来源互指与关联缺失，异常则整批不改动。
        </p>
      </div>
      <el-radio-group v-model="mode" type="button">
        <el-radio-button value="merge">合并两条</el-radio-button>
        <el-radio-button value="split">拆分一条</el-radio-button>
      </el-radio-group>
    </div>

    <!-- ============ 合并 ============ -->
    <template v-if="mode === 'merge'">
      <el-card shadow="never" class="block">
        <template #header>选择主条目与来源条目</template>
        <div class="pick-row">
          <div class="pick-field">
            <span class="pick-lab">主条目（保留并继续补全）</span>
            <el-select v-model="mergeMainId" filterable placeholder="选择主条目" style="width: 100%">
              <el-option
                v-for="record in recordState.records"
                :key="record.id"
                :label="`${record.code} · ${record.tempName || '未命名'}`"
                :value="record.id"
              />
            </el-select>
          </div>
          <el-button class="swap-btn" @click="swapMerge">⇄ 互换</el-button>
          <div class="pick-field">
            <span class="pick-lab">来源条目（并入后保留为来源快照）</span>
            <el-select v-model="mergeSourceId" filterable placeholder="选择来源条目" style="width: 100%">
              <el-option
                v-for="record in recordState.records"
                :key="record.id"
                :label="`${record.code} · ${record.tempName || '未命名'}`"
                :value="record.id"
                :disabled="record.id === mergeMainId"
              />
            </el-select>
          </div>
        </div>
        <p class="tip">合并不会删除任何记录：来源条目保留原编号与未转移的观察，仅标记「已并入主条目」。</p>
      </el-card>

      <template v-if="mergeMain && mergeSource">
        <el-card shadow="never" class="block">
          <template #header>
            <div class="block-head">
              <span>逐项选择冲突形态值（{{ mergeConflicts.length }} 项不一致）</span>
              <span class="muted">一致字段自动保留主条目取值</span>
            </div>
          </template>
          <el-empty v-if="mergeConflicts.length === 0" description="两条记录的形态字段完全一致，可直接合并观察留痕" />
          <div v-for="field in mergeConflicts" :key="field.key" class="conflict-row">
            <span class="conf-label">{{ field.label }}</span>
            <el-radio-group v-model="chosen[field.key]">
              <el-radio-button value="main">
                主条目 · {{ fieldDisplay(field, mergeMain[field.key], pointState.points) }}
              </el-radio-button>
              <el-radio-button value="source">
                来源 · {{ fieldDisplay(field, mergeSource[field.key], pointState.points) }}
              </el-radio-button>
            </el-radio-group>
          </div>
        </el-card>

        <el-card shadow="never" class="block">
          <template #header>
            <div class="block-head">
              <span>孢子印与鉴定留痕归属</span>
              <div class="head-actions">
                <el-button size="small" @click="setAllSporeTransfer(true)">全转孢子印</el-button>
                <el-button size="small" @click="setAllSporeTransfer(false)">全留来源</el-button>
                <el-button size="small" @click="setAllIdentifyTransfer(true)">全转鉴定</el-button>
                <el-button size="small" @click="setAllIdentifyTransfer(false)">全留来源</el-button>
              </div>
            </div>
          </template>

          <h4 class="sub-title">孢子印（来源 {{ sourceSpores.length }} 条 · 主条目 {{ mainSpores.length }} 条）</h4>
          <el-table :data="sourceSpores" border size="small" class="obs-table">
            <el-table-column label="转到主条目" width="110">
              <template #default="{ row }: { row: SporePrint }">
                <el-checkbox v-model="transferSpore[row.id]">转移</el-checkbox>
              </template>
            </el-table-column>
            <el-table-column label="印色" width="90">
              <template #default="{ row }: { row: SporePrint }">
                <SporePrintSwatch :color="row.color" />
              </template>
            </el-table-column>
            <el-table-column prop="shape" label="印形" min-width="160" />
            <el-table-column prop="hours" label="时长" width="80" />
            <el-table-column prop="observeDate" label="观察日期" width="120" />
            <el-table-column label="归属" width="120">
              <template #default="{ row }: { row: SporePrint }">
                <el-tag v-if="transferSpore[row.id]" type="success" size="small">转至主条目</el-tag>
                <el-tag v-else type="info" size="small" effect="plain">留来源快照</el-tag>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="sourceSpores.length === 0" description="来源条目没有孢子印" :image-size="60" />

          <h4 class="sub-title">鉴定留痕（来源 {{ sourceIdentifies.length }} 条 · 主条目 {{ mainIdentifies.length }} 条）</h4>
          <el-table :data="sourceIdentifies" border size="small" class="obs-table">
            <el-table-column label="转到主条目" width="110">
              <template #default="{ row }: { row: { id: string } }">
                <el-checkbox v-model="transferIdentify[row.id]">转移</el-checkbox>
              </template>
            </el-table-column>
            <el-table-column prop="conclusion" label="结论学名" min-width="160" />
            <el-table-column prop="basis" label="依据" width="100" />
            <el-table-column prop="confidence" label="置信度" width="90" />
            <el-table-column prop="date" label="日期" width="120" />
            <el-table-column label="归属" width="120">
              <template #default="{ row }: { row: { id: string } }">
                <el-tag v-if="transferIdentify[row.id]" type="success" size="small">转至主条目</el-tag>
                <el-tag v-else type="info" size="small" effect="plain">留来源快照</el-tag>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="sourceIdentifies.length === 0" description="来源条目没有鉴定留痕" :image-size="60" />

          <div class="confirm-bar">
            <el-tag type="warning" effect="plain">
              合并后：主条目 {{ mergeMain.code }} 保留 {{ mainSpores.length }} 条孢子印 +
              {{ sourceSpores.filter((s) => transferSpore[s.id]).length }} 条转入；
              来源快照 {{ mergeSource.code }} 保留 {{ sourceSpores.filter((s) => !transferSpore[s.id]).length }} 条
            </el-tag>
            <el-button type="primary" @click="doMerge">确认合并</el-button>
          </div>
        </el-card>
      </template>
    </template>

    <!-- ============ 拆分 ============ -->
    <template v-if="mode === 'split'">
      <el-card shadow="never" class="block">
        <template #header>选择要拆分的原记录（一个编号混装两种菌）</template>
        <el-select v-model="splitOriginId" filterable placeholder="选择原记录" style="width: 100%; max-width: 520px">
          <el-option
            v-for="record in recordState.records"
            :key="record.id"
            :label="`${record.code} · ${record.tempName || '未命名'}（孢子印 ${sporeState.spores.filter((s) => s.recordId === record.id).length} · 鉴定 ${identifyState.logs.filter((i) => i.recordId === record.id).length}）`"
            :value="record.id"
          />
        </el-select>
        <p class="tip">拆分后原记录保留原编号与全部字段作为来源快照；每条新条目都有独立的新采集编号，孢子印与鉴定留痕按归属分配。</p>
      </el-card>

      <template v-if="splitOrigin">
        <el-card v-for="(draft, index) in splitDrafts" :key="index" shadow="never" class="block draft-card">
          <template #header>
            <div class="block-head">
              <span>新条目 {{ index + 1}}</span>
              <el-button v-if="splitDrafts.length > 2" size="small" type="danger" plain @click="removeDraft(index)">移除该条</el-button>
            </div>
          </template>
          <el-row :gutter="12">
            <el-col :span="8">
              <el-form-item label="新采集编号" required>
                <el-input v-model="draft.code" placeholder="如 BHS-2026-001-甲" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="暂定名">
                <el-input v-model="draft.tempName" placeholder="如 橙黄牛肝菌（暂定）" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="采集点">
                <el-select v-model="draft.pointId" style="width: 100%">
                  <el-option v-for="point in pointState.points" :key="point.id" :label="point.name" :value="point.id" />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>

          <h4 class="sub-title">孢子印归属（{{ originSpores.length }} 条）</h4>
          <div v-for="spore in originSpores" :key="spore.id" class="assign-row">
            <SporePrintSwatch :color="spore.color" :caption="sporeCaption(spore)" />
            <el-select v-model="sporeTarget[spore.id]" style="width: 260px">
              <el-option label="留在原记录（来源）" value="origin" />
              <el-option v-for="(_, dIndex) in splitDrafts" :key="dIndex" :label="`归入新条目 ${draftLabel(dIndex)}`" :value="`d${dIndex}`" />
            </el-select>
          </div>
          <el-empty v-if="originSpores.length === 0" description="原记录没有孢子印" :image-size="50" />

          <h4 class="sub-title">鉴定留痕归属（{{ originIdentifies.length }} 条）</h4>
          <div v-for="log in originIdentifies" :key="log.id" class="assign-row">
            <span class="assign-log">{{ log.conclusion }}（{{ log.confidence }} · {{ log.date }}）</span>
            <el-select v-model="identifyTarget[log.id]" style="width: 260px">
              <el-option label="留在原记录（来源）" value="origin" />
              <el-option v-for="(_, dIndex) in splitDrafts" :key="dIndex" :label="`归入新条目 ${draftLabel(dIndex)}`" :value="`d${dIndex}`" />
            </el-select>
          </div>
          <el-empty v-if="originIdentifies.length === 0" description="原记录没有鉴定留痕" :image-size="50" />
        </el-card>

        <div class="add-draft">
          <el-button @click="addDraft">+ 再添加一条新条目</el-button>
        </div>

        <el-card shadow="never" class="block">
          <div class="confirm-bar">
            <el-tag type="warning" effect="plain">
              拆分为 {{ splitDrafts.length }} 条独立条目，原编号 {{ splitOrigin.code }} 保留为来源
            </el-tag>
            <el-button type="primary" @click="doSplit">确认拆分</el-button>
          </div>
        </el-card>
      </template>
    </template>

    <!-- ============ 整理留痕（历史） ============ -->
    <el-card shadow="never" class="block">
      <template #header>整理留痕（{{ organizeState.logs.length }}）</template>
      <el-table :data="organizeState.logs" border size="small">
        <el-table-column prop="at" label="时间" width="170">
          <template #default="{ row }: { row: { at: string } }">{{ row.at.replace('T', ' ').slice(0, 16) }}</template>
        </el-table-column>
        <el-table-column label="方式" width="90">
          <template #default="{ row }: { row: { kind: string } }">
            <el-tag :type="row.kind === 'merge' ? 'warning' : 'success'" size="small">
              {{ row.kind === 'merge' ? '合并' : '拆分' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="内容" min-width="320">
          <template #default="{ row }: { row: any }">
            <template v-if="row.kind === 'merge'">
              主条目
              <el-button link type="primary" @click="router.push(`/atlas/${row.mainId}`)">{{ row.mainCode }}</el-button>
              ← 来源快照
              <el-button link type="primary" @click="router.push(`/atlas/${row.sourceId}`)">{{ row.sourceCode }}</el-button>
              <span class="muted">
                （冲突 {{ Object.keys(row.chosen ?? {}).length }} 项 · 转孢子印 {{ row.transferredSporeIds?.length ?? 0 }} ·
                转鉴定 {{ row.transferredIdentifyIds?.length ?? 0 }}）
              </span>
            </template>
            <template v-else>
              原记录
              <el-button link type="primary" @click="router.push(`/atlas/${row.originId}`)">{{ row.originCode }}</el-button>
              →
              <el-button
                v-for="(id, idx) in row.newIds"
                :key="id"
                link
                type="primary"
                @click="router.push(`/atlas/${id}`)"
              >
                {{ row.newCodes[idx] }}<span v-if="idx < row.newIds.length - 1">、</span>
              </el-button>
            </template>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="organizeState.logs.length === 0" description="还没有整理记录" :image-size="60" />
    </el-card>
  </div>
</template>

<style scoped>
.block {
  border-radius: 12px;
  margin-bottom: 16px;
}
.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.pick-row {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}
.pick-field {
  flex: 1 1 280px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pick-lab {
  font-size: 12px;
  color: #6f7d72;
}
.swap-btn {
  margin-bottom: 2px;
}
.tip {
  margin: 10px 0 0;
  font-size: 12px;
  color: #7f8d82;
}
.conflict-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px dashed #eef2f6;
}
.conf-label {
  width: 110px;
  flex-shrink: 0;
  font-size: 13px;
  color: #4b5b50;
}
.sub-title {
  margin: 14px 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: #3b4a40;
}
.obs-table {
  margin-bottom: 8px;
}
.confirm-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
  flex-wrap: wrap;
}
.draft-card {
  border-left: 3px solid #c96f3a;
}
.assign-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px dotted #eef2f6;
}
.assign-log {
  font-size: 13px;
  color: #2b3a2f;
}
.add-draft {
  margin-bottom: 16px;
}
.muted {
  color: #7f8d82;
  font-size: 12px;
}
.head-actions {
  display: flex;
  gap: 6px;
}
</style>
