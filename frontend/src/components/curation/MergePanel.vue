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
import { FIELD_GROUPS, TRAIT_FIELDS, formatTrait, getTrait, type TraitFieldMeta } from '@/utils/curation'
import { uid } from '@/utils/id'
import AttachmentAssignTable from '@/components/common/AttachmentAssignTable.vue'

const emit = defineEmits<{ (event: 'done'): void }>()

const router = useRouter()
const recordState = useStore(recordStore)
const sporeState = useStore(sporeStore)
const identifyState = useStore(identifyStore)
const pointState = useStore(pointStore)

const activeRecords = computed(() => recordState.records.filter((record) => record.status === 'active'))

/* ---------- 步骤一：选择参与条目与主条目 ---------- */
const pickedIds = ref<string[]>([])
const masterId = ref('')
const keyword = ref('')

const selectable = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text) return activeRecords.value
  return activeRecords.value.filter((record) =>
    [record.code, record.tempName, record.hostTree, record.collector].join(' ').toLowerCase().includes(text)
  )
})

function togglePick(id: string): void {
  if (pickedIds.value.includes(id)) {
    pickedIds.value = pickedIds.value.filter((item) => item !== id)
    if (masterId.value === id) masterId.value = ''
    return
  }
  pickedIds.value = [...pickedIds.value, id]
}

watch(pickedIds, (ids) => {
  if (masterId.value && !ids.includes(masterId.value)) masterId.value = ''
  if (!masterId.value && ids.length > 0) masterId.value = ids[0]
})

const participants = computed<FungusRecord[]>(() =>
  pickedIds.value
    .map((id) => recordState.records.find((record) => record.id === id))
    .filter((record): record is FungusRecord => Boolean(record))
)
const master = computed(() => participants.value.find((record) => record.id === masterId.value) ?? null)
const sources = computed(() => participants.value.filter((record) => record.id !== masterId.value))

const canNext = computed(() => participants.value.length >= 2 && Boolean(master.value))

/* ---------- 步骤二：逐项选择形态冲突值 ---------- */
const fieldChoices = ref<Record<string, string>>({})
let lastMasterId = ''

watch(
  [pickedIds, masterId],
  () => {
    // 默认采用主条目的值；切换主条目后全部回到新主条目，增删参与条目时仅剔除越界选择
    if (!masterId.value) {
      fieldChoices.value = {}
      lastMasterId = ''
      return
    }
    const masterChanged = lastMasterId && lastMasterId !== masterId.value
    const next: Record<string, string> = {}
    for (const field of TRAIT_FIELDS) {
      const chosen = fieldChoices.value[field.key]
      next[field.key] =
        !masterChanged && chosen && pickedIds.value.includes(chosen) ? chosen : masterId.value
    }
    fieldChoices.value = next
    lastMasterId = masterId.value
  },
  { immediate: true, deep: true }
)

function isConflict(field: TraitFieldMeta): boolean {
  const values = new Set(participants.value.map((record) => String(getTrait(record, field.key))))
  return values.size > 1
}

/** 冲突行高亮（模板内不写类型注解） */
function conflictRowClass(param: { row: TraitFieldMeta }): string {
  return isConflict(param.row) ? 'conflict-row' : ''
}

const fieldGroups = computed(() =>
  FIELD_GROUPS.map((group) => ({
    ...group,
    fields: TRAIT_FIELDS.filter((field) => field.group === group.key)
  }))
)

function chooseField(field: TraitFieldMeta, recordId: string): void {
  fieldChoices.value = { ...fieldChoices.value, [field.key]: recordId }
}

function displayValue(field: TraitFieldMeta, record: FungusRecord): string {
  if (field.key === 'pointId') {
    return pointState.points.find((point) => point.id === record.pointId)?.name ?? '未关联采集点'
  }
  return formatTrait(field, getTrait(record, field.key))
}

/* ---------- 步骤三：孢子印 / 鉴定留痕去向 ---------- */
const assignment = ref<Record<string, string>>({})
let lastAssignmentMaster = ''

const participantSpores = computed(() =>
  sporeState.spores.filter((spore) => pickedIds.value.includes(spore.recordId))
)
const participantLogs = computed(() =>
  identifyState.logs.filter((log) => pickedIds.value.includes(log.recordId))
)

watch(
  [pickedIds, masterId],
  () => {
    // 默认全部转到主条目；主条目切换后整体回到新主条目，增删参与条目时保留有效旧选择
    const masterChanged = lastAssignmentMaster && lastAssignmentMaster !== masterId.value
    const next: Record<string, string> = {}
    const pickTarget = (itemId: string, owner: string): string => {
      const previous = assignment.value[itemId]
      if (!masterChanged && previous && pickedIds.value.includes(previous)) return previous
      return masterId.value || owner
    }
    for (const spore of participantSpores.value) next[spore.id] = pickTarget(spore.id, spore.recordId)
    for (const log of participantLogs.value) next[log.id] = pickTarget(log.id, log.recordId)
    assignment.value = next
    lastAssignmentMaster = masterId.value
  },
  { immediate: true, deep: true }
)

const assignOptions = computed<{ value: string; label: string; archived?: boolean }[]>(() => {
  if (!master.value) return []
  const options: { value: string; label: string; archived?: boolean }[] = [
    { value: master.value.id, label: `${master.value.code}（主条目）` }
  ]
  for (const source of sources.value) {
    options.push({ value: source.id, label: source.code, archived: true })
  }
  return options
})

/* ---------- 提交 ---------- */
const submitting = ref(false)

async function submit(): Promise<void> {
  if (!master.value) return
  const items = [...participantSpores.value.map((spore) => ({ itemId: spore.id, kind: 'spore' as const })),
    ...participantLogs.value.map((log) => ({ itemId: log.id, kind: 'identify' as const }))]
  submitting.value = true
  try {
    await curationStore.getState().merge({
      eventId: uid('cur'),
      date: new Date().toISOString().slice(0, 10),
      operator: master.value.collector,
      masterId: master.value.id,
      sourceIds: sources.value.map((record) => record.id),
      fieldChoices: { ...fieldChoices.value },
      attachments: items.map((item) => ({
        itemId: item.itemId,
        kind: item.kind,
        targetRecordId: assignment.value[item.itemId] ?? masterId.value
      }))
    })
    const targetId = master.value.id
    ElMessage.success('合并完成：来源条目已归档为快照，主条目与转移的孢子印、鉴定留痕均可追溯')
    pickedIds.value = []
    masterId.value = ''
    emit('done')
    void router.push(`/atlas/${targetId}`)
  } catch (error) {
    ElMessage.error(`已停止整理，原记录、孢子印和鉴定留痕均未改动：${(error as CurationGuardError).message}`)
  } finally {
    submitting.value = false
  }
}

const movedCount = computed(
  () =>
    [...participantSpores.value, ...participantLogs.value].filter(
      (item) => assignment.value[item.id] && assignment.value[item.id] === masterId.value
    ).length
)
</script>

<template>
  <div class="merge-panel">
    <el-card shadow="never" class="step">
      <template #header>
        <div class="step-head">
          <el-tag type="primary" effect="dark">第 1 步</el-tag>
          <span>勾选同一份标本重复登记的条目（{{ pickedIds.length }} 条），再指定一条作为主条目</span>
        </div>
      </template>
      <div class="toolbar-line">
        <el-input v-model="keyword" placeholder="按编号 / 暂定名 / 树种 / 采集人筛选" clearable style="width: 300px" />
        <el-button v-if="pickedIds.length" @click="pickedIds = []">清空选择</el-button>
      </div>
      <el-table :data="selectable" border size="small" max-height="300" class="pick-table">
        <el-table-column width="56" align="center">
          <template #default="{ row }">
            <el-checkbox :model-value="pickedIds.includes(row.id)" @change="togglePick(row.id)" />
          </template>
        </el-table-column>
        <el-table-column label="采集编号" prop="code" width="170" />
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
        <el-table-column label="主条目" width="110" align="center">
          <template #default="{ row }">
            <el-radio v-model="masterId" :value="row.id" :disabled="!pickedIds.includes(row.id)">主条目</el-radio>
          </template>
        </el-table-column>
      </el-table>
      <p v-if="pickedIds.length > 0 && pickedIds.length < 2" class="tip warn">再至少选择 1 条参与合并</p>
      <p v-else-if="pickedIds.length >= 2" class="tip">
        主条目：<b>{{ master?.code }}</b>；来源 {{ sources.length }} 条将归档保留为来源快照。
      </p>
    </el-card>

    <template v-if="canNext && master">
      <el-card shadow="never" class="step">
        <template #header>
          <div class="step-head">
            <el-tag type="primary" effect="dark">第 2 步</el-tag>
            <span>逐项选择主条目最终采用的形态值；橙色行为冲突项，未采用的观察仍随来源快照保留</span>
          </div>
        </template>
        <div v-for="group in fieldGroups" :key="group.key" class="field-group">
          <div class="group-title">{{ group.title }}</div>
          <el-table :data="group.fields" border size="small" :row-class-name="conflictRowClass">
            <el-table-column label="字段" width="130">
              <template #default="{ row }">
                {{ row.label }}
                <el-tag v-if="isConflict(row)" type="warning" size="small" effect="plain">冲突</el-tag>
                <el-tag v-else type="success" size="small" effect="plain">一致</el-tag>
              </template>
            </el-table-column>
            <el-table-column v-for="record in participants" :key="record.id" :label="record.code" min-width="170">
              <template #header>
                <span :class="{ masterHead: record.id === masterId }">
                  {{ record.code }}{{ record.id === masterId ? ' ★' : '' }}
                </span>
              </template>
              <template #default="{ row }">
                <el-radio
                  :model-value="fieldChoices[row.key]"
                  :value="record.id"
                  @change="chooseField(row, record.id)"
                >
                  {{ displayValue(row, record) }}
                </el-radio>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-card>

      <el-card shadow="never" class="step">
        <template #header>
          <div class="step-head">
            <el-tag type="primary" effect="dark">第 3 步</el-tag>
            <span>指定哪些孢子印和鉴定留痕转到主条目；未转走的仍随来源快照保留，原记录本身不修改</span>
          </div>
        </template>
        <AttachmentAssignTable
          v-model="assignment"
          :spores="participantSpores"
          :identifies="participantLogs"
          :options="assignOptions"
          :default-label="`转到 ${master.code}`"
        />
        <div class="submit-bar">
          <span class="tip">合并后主条目将承接 {{ movedCount }} 项孢子印 / 鉴定留痕。</span>
          <el-button type="primary" :loading="submitting" @click="submit">确认合并并归档来源</el-button>
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
  margin-bottom: 10px;
}
.tip {
  margin: 10px 0 0;
  font-size: 12px;
  color: #6f7d72;
}
.tip.warn {
  color: #a45b1f;
}
.field-group {
  margin-bottom: 12px;
}
.group-title {
  margin: 4px 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: #8a6a3d;
}
.masterHead {
  font-weight: 700;
  color: #c96f3a;
}
.submit-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
}
:deep(.conflict-row) {
  background: #fdf3e7;
}
</style>
