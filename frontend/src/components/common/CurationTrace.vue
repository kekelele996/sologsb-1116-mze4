<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { CurationEvent, FungusRecord } from '@/types'
import { useStore } from '@/hooks/usePersistentStore'
import { recordStore } from '@/stores/recordStore'
import { curationStore } from '@/stores/curationStore'
import { TRAIT_FIELD_MAP } from '@/utils/curation'

const props = defineProps<{
  record: FungusRecord
  /** 是否为归档快照（详情页顶部用警告条样式） */
  banner?: boolean
}>()

const router = useRouter()
const recordState = useStore(recordStore)
const curationState = useStore(curationStore)

/** 溯源折叠面板：默认全部收起，用户可自行展开 */
const openedPanels = ref<string[]>([])

/** 本条作为主条目 / 来源参与过的整理事件（按时间倒序） */
const events = computed<CurationEvent[]>(() =>
  curationState.events.filter((event) => {
    const data = event.data
    if (data.kind === 'merge') {
      return data.masterId === props.record.id || data.sourceIds.includes(props.record.id)
    }
    return data.sourceId === props.record.id || data.resultIds.includes(props.record.id)
  })
)

const mergedMaster = computed(() =>
  props.record.status === 'merged' && props.record.mergedIntoId
    ? recordState.records.find((item) => item.id === props.record.mergedIntoId) ?? null
    : null
)

const splitSource = computed(() =>
  props.record.status === 'active' && props.record.splitFromId
    ? recordState.records.find((item) => item.id === props.record.splitFromId) ?? null
    : null
)

/** 本条作为来源时：合并事件中未采用的字段（来源值与主条目最终值不同） */
const unadoptedRows = computed(() => {
  const event = events.value.find((item) => {
    if (item.data.kind !== 'merge') return false
    return item.data.sourceIds.includes(props.record.id)
  })
  if (!event || event.data.kind !== 'merge') return []
  const data = event.data
  const master = recordState.records.find((item) => item.id === data.masterId)
  if (!master) return []
  const snapshot = event.recordSnapshots.find((item) => item.id === props.record.id)
  if (!snapshot) return []
  return Object.entries(data.fieldChoices)
    .filter(([, chosenId]) => chosenId !== props.record.id)
    .map(([key]) => {
      const meta = TRAIT_FIELD_MAP[key]
      const sourceValue = snapshot[key as keyof FungusRecord]
      const masterValue = master[key as keyof FungusRecord]
      return {
        label: meta?.label ?? key,
        source: String(sourceValue ?? '—'),
        master: String(masterValue ?? '—')
      }
    })
})

/** 该来源快照仍保留的孢子印 / 鉴定留痕（未随整理转走的观察） */
const retainedAttachments = computed(() => {
  const event = events.value.find((item) =>
    item.data.kind === 'merge'
      ? item.data.sourceIds.includes(props.record.id)
      : item.data.kind === 'split' && item.data.sourceId === props.record.id
  )
  if (!event) return []
  return event.data.attachments.filter((item) => item.originRecordId === props.record.id && item.targetRecordId === props.record.id)
})

function eventTitle(event: CurationEvent): string {
  if (event.data.kind === 'merge') {
    const role = event.data.masterId === props.record.id ? '主条目' : '被合并来源'
    return `合并整理（本条为${role}）· ${event.date}`
  }
  const role = event.data.sourceId === props.record.id ? '被拆分来源' : '拆分产物'
  return `拆分整理（本条为${role}）· ${event.date}`
}

/** 当前条作为来源的拆分事件（模板里避免直接做联合类型收窄） */
const splitAsSourceEvents = computed(() =>
  events.value
    .filter((event) => event.data.kind === 'split' && event.data.sourceId === props.record.id)
    .map((event) => event.data as Extract<CurationEvent['data'], { kind: 'split' }>)
)

function recordLabel(id: string): string {
  return recordState.records.find((item) => item.id === id)?.code ?? id
}

function open(id: string): void {
  void router.push(`/atlas/${id}`)
}
</script>

<template>
  <el-alert
    v-if="banner && record.status === 'merged'"
    type="warning"
    :closable="false"
    show-icon
    class="banner"
  >
    <template #title>
      该条目已于整理中合并到主条目
      <el-link type="primary" :underline="false" @click="mergedMaster && open(mergedMaster.id)">
        {{ mergedMaster?.code ?? '（主条目）' }}
      </el-link>
      ；本页为来源快照，原始形态、孢子印与鉴定留痕均保持原样，仅可查看。
    </template>
  </el-alert>
  <el-alert
    v-else-if="banner && record.status === 'split'"
    type="warning"
    :closable="false"
    show-icon
    class="banner"
  >
    <template #title>
      该编号已拆分为
      <template v-for="(data, index) in splitAsSourceEvents" :key="data.sourceId + index">
        <el-link
          v-for="(resultId, resultIndex) in data.resultIds"
          :key="resultId"
          type="primary"
          :underline="false"
          @click="open(resultId)"
        >{{ recordLabel(resultId) }}<template v-if="resultIndex < data.resultIds.length - 1">、</template></el-link><template v-if="index < splitAsSourceEvents.length - 1">；</template>
      </template>
      ；本页为原编号来源快照，原字段与未转出的观察保持原样。
    </template>
  </el-alert>

  <div v-if="events.length > 0 || splitSource" class="trace">
    <div v-if="splitSource" class="trace-line">
      <el-tag size="small" type="warning" effect="plain">拆分自</el-tag>
      <el-link type="primary" :underline="false" @click="open(splitSource.id)">
        {{ splitSource.code }}
      </el-link>
      <span class="muted">原编号与字段作为来源保留</span>
    </div>

    <el-collapse v-if="events.length > 0" v-model="openedPanels" class="trace-events">
      <el-collapse-item v-for="event in events" :key="event.id" :name="event.id">
        <template #title>
          <span class="event-title">{{ eventTitle(event) }}</span>
          <el-tag v-if="event.operator" size="small" effect="plain" class="operator">{{ event.operator }}</el-tag>
        </template>
        <div class="event-body">
          <template v-if="event.data.kind === 'merge'">
            <p class="line">
              主条目：
              <el-link :underline="false" @click="open(event.data.masterId)">{{ recordLabel(event.data.masterId) }}</el-link>
              ；来源：
              <el-link
                v-for="sourceId in event.data.sourceIds"
                :key="sourceId"
                :underline="false"
                @click="open(sourceId)"
              >{{ recordLabel(sourceId) }} </el-link>
            </p>
            <ul v-if="event.data.masterId === record.id" class="choice-list">
              <li v-for="(chosenId, key) in event.data.fieldChoices" :key="key">
                <b>{{ TRAIT_FIELD_MAP[key]?.label ?? key }}</b>采用自
                <el-link :underline="false" @click="open(chosenId)">{{ recordLabel(chosenId) }}</el-link>
                ；未采用值仍保留在各来源快照。
              </li>
            </ul>
            <ul v-else-if="unadoptedRows.length" class="choice-list">
              <li v-for="row in unadoptedRows" :key="row.label">
                <b>{{ row.label }}</b>：来源观察「{{ row.source }}」未采用，主条目最终为「{{ row.master }}」，本条快照保留原值。
              </li>
            </ul>
          </template>
          <template v-else>
            <p class="line">
              来源：
              <el-link :underline="false" @click="open(event.data.sourceId)">{{ recordLabel(event.data.sourceId) }}</el-link>
              ；拆出
              <el-link
                v-for="resultId in event.data.resultIds"
                :key="resultId"
                class="result-link"
                :underline="false"
                @click="open(resultId)"
              >{{ recordLabel(resultId) }} </el-link>
            </p>
          </template>
          <div v-if="event.data.attachments.length" class="attach-list">
            <p class="attach-title">孢子印 / 鉴定留痕去向：</p>
            <ul>
              <li v-for="attachment in event.data.attachments" :key="`${attachment.kind}-${attachment.itemId}`">
                <el-tag size="small" :type="attachment.kind === 'spore' ? 'primary' : 'success'" effect="plain">
                  {{ attachment.kind === 'spore' ? '孢子印' : '鉴定' }}
                </el-tag>
                {{ attachment.summary }}：
                <el-link :underline="false" @click="open(attachment.targetRecordId)">
                  {{ recordLabel(attachment.targetRecordId) }}
                </el-link>
                <span v-if="attachment.targetRecordId !== attachment.originRecordId" class="muted">（自来源转入）</span>
                <span v-else class="muted">（随来源快照保留）</span>
              </li>
            </ul>
          </div>
          <div v-if="retainedAttachments.length && (record.status === 'merged' || record.status === 'split')" class="retain-note">
            本快照保留 {{ retainedAttachments.length }} 项未转出的观察，可在下方原始区域查阅。
          </div>
        </div>
      </el-collapse-item>
    </el-collapse>
  </div>
</template>

<style scoped>
.banner {
  margin-bottom: 12px;
}
.trace {
  margin-bottom: 12px;
}
.trace-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  margin-bottom: 8px;
}
.trace-events {
  border: 1px solid #e8e2d6;
  border-radius: 10px;
  padding: 0 12px;
}
.event-title {
  font-size: 12px;
  font-weight: 600;
  color: #6f5a42;
}
.operator {
  margin-left: 8px;
}
.event-body {
  font-size: 12px;
  color: #4b5b50;
  line-height: 1.8;
}
.line {
  margin: 4px 0;
}
.choice-list,
.attach-list ul {
  margin: 4px 0;
  padding-left: 18px;
}
.result-link {
  margin: 0 4px;
}
.attach-title {
  margin: 6px 0 0;
  font-weight: 600;
}
.retain-note {
  margin-top: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  background: #f7f5f0;
  color: #8a6a3d;
}
</style>
