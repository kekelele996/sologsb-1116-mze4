<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { FungusRecord } from '@/types'
import { useStore } from '@/hooks/usePersistentStore'
import { recordStore } from '@/stores/recordStore'
import { sporeStore } from '@/stores/sporeStore'
import { identifyStore } from '@/stores/identifyStore'
import { pointStore } from '@/stores/pointStore'
import { curationStore } from '@/stores/curationStore'
import { CurationGuardError } from '@/utils/guards'
import { TRAIT_FIELDS } from '@/utils/curation'
import { uid } from '@/utils/id'
import RecordDraftForm, { type DraftFields } from '@/components/common/RecordDraftForm.vue'
import AttachmentAssignTable from '@/components/common/AttachmentAssignTable.vue'

const emit = defineEmits<{ (event: 'done'): void }>()

const router = useRouter()
const recordState = useStore(recordStore)
const sporeState = useStore(sporeStore)
const identifyState = useStore(identifyStore)
const pointState = useStore(pointStore)

const activeRecords = computed(() => recordState.records.filter((record) => record.status === 'active'))
const keyword = ref('')
const sourceId = ref('')

const selectable = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text) return activeRecords.value
  return activeRecords.value.filter((record) =>
    [record.code, record.tempName, record.hostTree, record.collector].join(' ').toLowerCase().includes(text)
  )
})

const source = computed<FungusRecord | null>(
  () => recordState.records.find((record) => record.id === sourceId.value) ?? null
)
const sourceSpores = computed(() => sporeState.spores.filter((spore) => spore.recordId === sourceId.value))
const sourceLogs = computed(() => identifyState.logs.filter((log) => log.recordId === sourceId.value))

interface Draft {
  /** 新记录 id（拆分提交时确定，提前生成以便关联项绑定去向） */
  rid: string
  code: string
  fields: DraftFields
}

const drafts = ref<Draft[]>([])
const resultCount = ref(2)
/** 关联项 id -> 目标条目 id（来源快照或某条新产物） */
const assignment = ref<Record<string, string>>({})

/** 从来源条目克隆全部形态字段（原编号与字段随后作为来源快照保留，不修改） */
function cloneFields(record: FungusRecord): DraftFields {
  const next: Record<string, string | number> = {}
  for (const field of TRAIT_FIELDS) {
    next[field.key] = record[field.key]
  }
  return next as unknown as DraftFields
}

/** 依据原编号生成建议新编号：末尾序号后追加 -A / -B …，用户可改 */
function suggestCode(baseCode: string, index: number): string {
  const suffix = String.fromCharCode(65 + index)
  return /-\d+$/.test(baseCode) ? `${baseCode}-${suffix}` : `${baseCode}-${index + 1}`
}

watch([sourceId, resultCount], () => {
  if (!source.value) {
    drafts.value = []
    return
  }
  const next: Draft[] = []
  for (let index = 0; index < resultCount.value; index += 1) {
    const existed = drafts.value[index]
    next.push({
      rid: existed?.rid ?? uid('rec'),
      code: existed?.code ?? suggestCode(source.value.code, index),
      fields: existed?.fields ?? cloneFields(source.value)
    })
  }
  drafts.value = next
  // 默认全部留在来源快照；仅保留仍属于当前来源、且目标仍有效的旧选择
  const ridSet = new Set(next.map((draft) => draft.rid))
  const nextAssignment: Record<string, string> = {}
  const keep = (itemId: string, owner: string): string => {
    const previous = assignment.value[itemId]
    return previous && (previous === owner || ridSet.has(previous)) ? previous : owner
  }
  for (const spore of sourceSpores.value) nextAssignment[spore.id] = keep(spore.id, sourceId.value)
  for (const log of sourceLogs.value) nextAssignment[log.id] = keep(log.id, sourceId.value)
  assignment.value = nextAssignment
})

const assignOptions = computed<{ value: string; label: string; archived?: boolean }[]>(() => {
  if (!source.value) return []
  const options: { value: string; label: string; archived?: boolean }[] = [
    { value: source.value.id, label: `${source.value.code}（来源快照保留）`, archived: true }
  ]
  drafts.value.forEach((draft, index) => {
    options.push({ value: draft.rid, label: `${draft.code || `新条目 ${index + 1}`}（新）` })
  })
  return options
})

/** 某条产物当前承接的关联项数量（提交时也以此为准，从 assignment 直接推导） */
function attachedCount(rid: string): number {
  return Object.values(assignment.value).filter((target) => target === rid).length
}

const submitting = ref(false)

async function submit(): Promise<void> {
  if (!source.value) return
  submitting.value = true
  const firstRid = drafts.value[0]?.rid ?? ''
  try {
    await curationStore.getState().split({
      eventId: uid('cur'),
      date: new Date().toISOString().slice(0, 10),
      operator: source.value.collector,
      sourceId: source.value.id,
      results: drafts.value.map((draft) => ({
        id: draft.rid,
        code: draft.code.trim(),
        fields: draft.fields,
        attachmentItemIds: Object.entries(assignment.value)
          .filter(([, target]) => target === draft.rid)
          .map(([itemId]) => itemId)
      }))
    })
    ElMessage.success('拆分完成：已生成独立条目与新采集编号，原编号和字段作为来源快照保留')
    sourceId.value = ''
    drafts.value = []
    assignment.value = {}
    emit('done')
    void router.push(`/atlas/${firstRid}`)
  } catch (error) {
    ElMessage.error(`已停止整理，原记录、孢子印和鉴定留痕均未改动：${(error as CurationGuardError).message}`)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="split-panel">
    <el-card shadow="never" class="step">
      <template #header>
        <div class="step-head">
          <el-tag type="warning" effect="dark">第 1 步</el-tag>
          <span>选择一个编号混装两种菌的来源条目（仅限正常条目，归档快照不能再拆）</span>
        </div>
      </template>
      <div class="toolbar-line">
        <el-input v-model="keyword" placeholder="按编号 / 暂定名 / 树种 / 采集人筛选" clearable style="width: 300px" />
      </div>
      <el-table :data="selectable" border size="small" max-height="280" @row-click="(row: FungusRecord) => (sourceId = row.id)">
        <el-table-column width="60" align="center">
          <template #default="{ row }">
            <el-radio v-model="sourceId" :value="row.id">选</el-radio>
          </template>
        </el-table-column>
        <el-table-column label="采集编号（原编号将留作来源）" prop="code" width="220" />
        <el-table-column label="暂定名" min-width="180">
          <template #default="{ row }">{{ row.tempName || '未命名条目' }}</template>
        </el-table-column>
        <el-table-column label="采集点" min-width="150">
          <template #default="{ row }">
            {{ pointState.points.find((point) => point.id === row.pointId)?.name ?? '未关联' }}
          </template>
        </el-table-column>
        <el-table-column label="孢子印 / 鉴定" width="130">
          <template #default="{ row }">
            {{ sporeState.spores.filter((spore) => spore.recordId === row.id).length }} 印 ·
            {{ identifyState.logs.filter((log) => log.recordId === row.id).length }} 鉴定
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <template v-if="source">
      <el-card shadow="never" class="step">
        <template #header>
          <div class="step-head">
            <el-tag type="warning" effect="dark">第 2 步</el-tag>
            <span>
              拆分为
              <el-input-number v-model="resultCount" :min="2" :max="6" size="small" controls-position="right" class="count-input" />
              条独立条目；每条填写新采集编号（不得与原编号或现有编号重复）并逐字段核对
            </span>
          </div>
        </template>
        <el-alert type="info" :closable="false" class="source-alert">
          来源：<span class="mono">{{ source.code }}</span>（{{ source.tempName || '未命名' }}）。原编号与原始字段值不修改，
          整理后该条转为来源快照。
        </el-alert>
        <div class="draft-list">
          <el-card v-for="(draft, index) in drafts" :key="draft.rid" shadow="never" class="draft-card">
            <template #header>
              <div class="draft-head">
                <el-tag type="warning" effect="plain">新条目 {{ String.fromCharCode(65 + index) }}</el-tag>
                <el-input v-model="draft.code" placeholder="新采集编号" class="code-input">
                  <template #prepend>编号</template>
                </el-input>
                <span class="muted">承接 {{ attachedCount(draft.rid) }} 项孢子印 / 鉴定</span>
              </div>
            </template>
            <RecordDraftForm v-model="draft.fields" :points="pointState.points" />
          </el-card>
        </div>
      </el-card>

      <el-card shadow="never" class="step">
        <template #header>
          <div class="step-head">
            <el-tag type="warning" effect="dark">第 3 步</el-tag>
            <span>指定孢子印和鉴定留痕转入哪条新条目；未分配的仍留在来源快照，不丢失、不改动</span>
          </div>
        </template>
        <AttachmentAssignTable
          v-model="assignment"
          :spores="sourceSpores"
          :identifies="sourceLogs"
          :options="assignOptions"
          :default-label="`留在 ${source.code} 来源快照`"
        />
        <div class="submit-bar">
          <span class="muted">拆分至少产生两条独立条目；新编号重复、来源互指或关联缺失都会自动拦下。</span>
          <el-button type="primary" :loading="submitting" @click="submit">确认拆分并生成新条目</el-button>
        </div>
      </el-card>
    </template>
  </div>
</template>

<style scoped>
.step {
  border-radius: 12px;
  margin-bottom: 16px;
}
.step-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.toolbar-line {
  display: flex;
  gap: 10px;
}
.count-input {
  width: 110px;
  margin: 0 6px;
}
.source-alert {
  margin-bottom: 12px;
}
.draft-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 12px;
}
.draft-card {
  border-radius: 10px;
  border: 1px dashed #e0c4a8;
}
.draft-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.code-input {
  width: 220px;
}
.submit-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
}
</style>
