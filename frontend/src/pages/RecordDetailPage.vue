<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { CollectPoint, SporeColor, SporePrint } from '@/types'
import { SPORE_COLORS } from '@/types'
import GeoPointForm from '@/components/common/GeoPointForm.vue'
import GillAttachmentTag from '@/components/common/GillAttachmentTag.vue'
import SporePrintSwatch from '@/components/common/SporePrintSwatch.vue'
import TraitsSummary from '@/components/common/TraitsSummary.vue'
import CurationTrace from '@/components/common/CurationTrace.vue'
import { useStore } from '@/hooks/usePersistentStore'
import { recordStore } from '@/stores/recordStore'
import { sporeStore } from '@/stores/sporeStore'
import { pointStore } from '@/stores/pointStore'
import { identifyStore } from '@/stores/identifyStore'
import { curationStore } from '@/stores/curationStore'
import { sporeColorHex } from '@/utils/spore'
import { uid } from '@/utils/id'

const route = useRoute()
const router = useRouter()
const recordState = useStore(recordStore)
const sporeState = useStore(sporeStore)
const pointState = useStore(pointStore)
const identifyState = useStore(identifyStore)
const curationState = useStore(curationStore)

const record = computed(() => recordState.records.find((item) => item.id === route.params.id) ?? null)
const spore = computed(() => sporeState.spores.find((item) => item.recordId === record.value?.id) ?? null)
const allSpores = computed(() => sporeState.spores.filter((item) => item.recordId === record.value?.id))
const logs = computed(() => identifyState.logs.filter((item) => item.recordId === record.value?.id))
const archived = computed(() => (record.value?.status ?? 'active') !== 'active')

/** 该孢子印 / 鉴定留痕是否由整理转入：查最新一次涉及该项的整理事件 */
function transferredIn(itemId: string): boolean {
  return curationState.events.some((event) =>
    event.data.attachments.some(
      (attachment) =>
        attachment.itemId === itemId &&
        attachment.targetRecordId === record.value?.id &&
        attachment.originRecordId !== record.value?.id
    )
  )
}
/** 该孢子印 / 鉴定留痕是否仍随来源快照保留（未转出） */
function retainedInSnapshot(itemId: string): boolean {
  return curationState.events.some((event) =>
    event.data.attachments.some(
      (attachment) =>
        attachment.itemId === itemId &&
        attachment.targetRecordId === record.value?.id &&
        attachment.originRecordId === record.value?.id
    )
  )
}
/** 当前条目所属采集点名称（在脚本内取，避免模板内箭头函数丢失空值收窄） */
const recordPointName = computed(() => {
  const current = record.value
  if (!current) return '未关联'
  return pointState.points.find((item) => item.id === current.pointId)?.name ?? '未关联'
})

const sporeForm = reactive({
  id: '',
  color: '白色' as SporeColor,
  shape: '',
  hours: 12,
  observeDate: new Date().toISOString().slice(0, 10),
  moisture: ''
})

const pointDraft = reactive<CollectPoint>({
  id: '',
  name: '',
  longitude: 0,
  latitude: 0,
  altitude: 0,
  vegetation: '针阔混交林',
  substrate: '落叶层',
  companionTrees: '',
  collectDate: '',
  collector: ''
})

watch(
  () => [record.value?.id, spore.value?.id, pointState.points.length] as const,
  () => {
    if (!record.value) return
    const current = spore.value
    if (current) {
      sporeForm.id = current.id
      sporeForm.color = current.color
      sporeForm.shape = current.shape
      sporeForm.hours = current.hours
      sporeForm.observeDate = current.observeDate
      sporeForm.moisture = current.moisture
    }
    const point = pointState.points.find((item) => item.id === record.value?.pointId)
    if (point) Object.assign(pointDraft, point)
  },
  { immediate: true }
)

async function saveSpore(): Promise<void> {
  if (!record.value) return
  const row: SporePrint = {
    id: sporeForm.id || uid('spo'),
    recordId: record.value.id,
    color: sporeForm.color,
    shape: sporeForm.shape.trim(),
    hours: Number(sporeForm.hours) || 0,
    observeDate: sporeForm.observeDate,
    moisture: sporeForm.moisture.trim()
  }
  await sporeStore.getState().save(row)
  sporeForm.id = row.id
  ElMessage.success(`孢子印观察已记录：${row.color}`)
}

async function savePoint(): Promise<void> {
  if (!pointDraft.name.trim()) {
    ElMessage.warning('采集点名称不能为空')
    return
  }
  await pointStore.getState().save({ ...pointDraft })
  ElMessage.success('采集点信息已更新')
}

async function removeSpore(): Promise<void> {
  if (!sporeForm.id) return
  await sporeStore.getState().remove(sporeForm.id)
  sporeForm.id = ''
  ElMessage.success('孢子印记录已删除')
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div v-if="record">
        <h2 class="page-title">{{ record.tempName || '未命名条目' }}</h2>
        <p class="page-sub">
          <span class="mono">{{ record.code }}</span> · 采集点
          {{ recordPointName }} · 采集日期
          {{ record.collectDate }} · 采集人 {{ record.collector || '—' }}
        </p>
      </div>
      <div v-else>
        <h2 class="page-title">条目详情</h2>
        <p class="page-sub">未找到该条目，可能已被删除。</p>
      </div>
      <div class="head-actions">
        <el-button @click="router.push('/atlas')">返回图谱</el-button>
        <el-button v-if="record && !archived" @click="router.push('/curation')">记录整理</el-button>
        <el-button v-if="record && !archived" @click="router.push('/identify')">去鉴定</el-button>
      </div>
    </div>

    <CurationTrace v-if="record" :record="record" banner />

    <template v-if="record">
      <el-card shadow="never" class="block">
        <template #header>
          <div class="block-head">
            <span>形态描述</span>
            <GillAttachmentTag :attachment="record.attachment" with-hint />
          </div>
        </template>
        <TraitsSummary :record="record" :spore="spore" :default-open="['cap', 'flesh', 'gill', 'stipe', 'eco']" />
        <p v-if="record.note" class="note">现场备注：{{ record.note }}</p>
      </el-card>

      <el-card shadow="never" class="block">
        <template #header>
          <div class="block-head">
            <span>孢子印观察（{{ allSpores.length }} 条）</span>
            <SporePrintSwatch :color="spore?.color ?? null" size="large" :caption="spore ? `获取 ${spore.hours} h` : '尚未记录'" />
          </div>
        </template>
        <el-alert
          v-if="allSpores.some((item) => transferredIn(item.id))"
          type="success"
          :closable="false"
          show-icon
          class="transfer-hint"
          title="以下含合并/拆分时转入的孢子印；带「随快照保留」标记的为未转出的原始观察。"
        />
        <el-table v-if="allSpores.length" :data="allSpores" border size="small" class="spore-table">
          <el-table-column label="印色" width="110">
            <template #default="{ row }: { row: SporePrint }">
              <SporePrintSwatch :color="row.color" :caption="''" />
            </template>
          </el-table-column>
          <el-table-column prop="shape" label="印形" min-width="150" />
          <el-table-column prop="hours" label="时长(h)" width="90" />
          <el-table-column prop="observeDate" label="观察日期" width="120" />
          <el-table-column prop="moisture" label="样本干湿度" min-width="140" />
          <el-table-column label="整理留痕" width="150">
            <template #default="{ row }: { row: SporePrint }">
              <el-tag v-if="transferredIn(row.id)" size="small" type="success" effect="dark">整理转入</el-tag>
              <el-tag v-else-if="retainedInSnapshot(row.id)" size="small" type="warning" effect="plain">随快照保留</el-tag>
              <span v-else class="muted">原始登记</span>
            </template>
          </el-table-column>
        </el-table>
        <div class="spore-body">
          <div class="spore-current" :style="{ background: spore ? sporeColorHex(spore.color) : '#f2f4f6' }">
            <div v-if="spore" class="spore-info">
              <p class="spore-color">{{ spore.color }}</p>
              <p class="spore-meta">印形：{{ spore.shape || '—' }}</p>
              <p class="spore-meta">时长：{{ spore.hours }} 小时 · 观察日期 {{ spore.observeDate }}</p>
              <p class="spore-meta">样本干湿度：{{ spore.moisture || '—' }}</p>
            </div>
            <p v-else class="spore-empty">该条目尚未登记孢子印观察</p>
          </div>
          <el-form label-width="92px" class="spore-form">
            <el-form-item label="印色">
              <el-select v-model="sporeForm.color" :disabled="archived" style="width: 100%">
                <el-option v-for="color in SPORE_COLORS" :key="color" :label="color" :value="color" />
              </el-select>
            </el-form-item>
            <el-form-item label="印形">
              <el-input v-model="sporeForm.shape" :disabled="archived" placeholder="如 圆形印痕，边缘略散" />
            </el-form-item>
            <el-form-item label="时长(h)">
              <el-input-number v-model="sporeForm.hours" :min="0" :step="1" :disabled="archived" :controls="false" style="width: 100%" />
            </el-form-item>
            <el-form-item label="观察日期">
              <el-date-picker v-model="sporeForm.observeDate" type="date" value-format="YYYY-MM-DD" :disabled="archived" style="width: 100%" />
            </el-form-item>
            <el-form-item label="干湿度">
              <el-input v-model="sporeForm.moisture" type="textarea" :rows="2" :disabled="archived" placeholder="如 子实体偏干，印痕较薄" />
            </el-form-item>
            <div v-if="!archived" class="form-actions">
              <el-button type="primary" @click="saveSpore">{{ sporeForm.id ? '更新孢子印' : '登记孢子印' }}</el-button>
              <el-button v-if="sporeForm.id" type="danger" plain @click="removeSpore">删除记录</el-button>
            </div>
            <p v-else class="muted">归档快照只读：孢子印原始记录不可修改或删除，可在整理溯源中查看去向。</p>
          </el-form>
        </div>
      </el-card>

      <el-card shadow="never" class="block">
        <template #header>采集点信息（含经纬度校验）{{ archived ? '· 快照只读' : '' }}</template>
        <GeoPointForm v-model="pointDraft" with-meta :disabled="archived" />
        <div v-if="!archived" class="form-actions">
          <el-button type="primary" @click="savePoint">保存采集点</el-button>
        </div>
      </el-card>

      <el-card shadow="never" class="block">
        <template #header>鉴定留痕（{{ logs.length }} 条）</template>
        <el-table :data="logs" border stripe>
          <el-table-column prop="date" label="日期" width="120" />
          <el-table-column prop="conclusion" label="结论学名" min-width="160" />
          <el-table-column prop="basis" label="依据" width="110" />
          <el-table-column label="参考图鉴" min-width="180">
            <template #default="{ row }: { row: { referenceBook: string; referencePage: string } }">
              {{ row.referenceBook || '—' }} {{ row.referencePage }}
            </template>
          </el-table-column>
          <el-table-column prop="confidence" label="置信度" width="90" />
          <el-table-column label="整理留痕" width="150">
            <template #default="{ row }: { row: { id: string } }">
              <el-tag v-if="transferredIn(row.id)" size="small" type="success" effect="dark">整理转入</el-tag>
              <el-tag v-else-if="retainedInSnapshot(row.id)" size="small" type="warning" effect="plain">随快照保留</el-tag>
              <span v-else class="muted">原始登记</span>
            </template>
          </el-table-column>
          <el-table-column label="复核" width="110">
            <template #default="{ row }: { row: { needReview: boolean; reviewer: string } }">
              <el-tag v-if="row.needReview" type="warning" size="small" effect="dark">待复核</el-tag>
              <span v-else class="muted">{{ row.reviewer || '已复核' }}</span>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="logs.length === 0" description="尚无鉴定结论，去「鉴定工作页」生成" />
      </el-card>
    </template>
  </div>
</template>

<style scoped>
.head-actions {
  display: flex;
  gap: 8px;
}
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
.transfer-hint {
  margin-bottom: 10px;
}
.spore-table {
  margin-bottom: 12px;
}
.note {
  margin: 10px 0 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f7f5f0;
  font-size: 12px;
  color: #6f7d72;
}
.spore-body {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}
.spore-current {
  flex: 1 1 260px;
  min-height: 180px;
  border-radius: 12px;
  border: 1px solid #e8e2d6;
  padding: 16px;
  display: flex;
  align-items: center;
}
.spore-info p {
  margin: 2px 0;
}
.spore-color {
  font-size: 20px;
  font-weight: 700;
}
.spore-meta {
  font-size: 12px;
  color: #4b5b50;
}
.spore-empty {
  font-size: 13px;
  color: #7f8d82;
}
.spore-form {
  flex: 1 1 320px;
}
.form-actions {
  display: flex;
  gap: 8px;
  padding-left: 92px;
}
</style>
