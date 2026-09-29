<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useStore } from '@/hooks/usePersistentStore'
import { recordStore } from '@/stores/recordStore'
import { curationStore } from '@/stores/curationStore'
import MergePanel from '@/components/curation/MergePanel.vue'
import SplitPanel from '@/components/curation/SplitPanel.vue'

const route = useRoute()
const router = useRouter()
const recordState = useStore(recordStore)
const curationState = useStore(curationStore)

const activeTab = ref<'merge' | 'split'>(route.query.mode === 'split' ? 'split' : 'merge')

function switchTab(mode: 'merge' | 'split'): void {
  activeTab.value = mode
  void router.replace({ path: '/curation', query: mode === 'merge' ? {} : { mode: 'split' } })
}

const archivedCount = computed(() => recordState.records.filter((record) => record.status !== 'active').length)

function recordLabel(id: string): string {
  return recordState.records.find((record) => record.id === id)?.code ?? id
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">记录整理</h2>
        <p class="page-sub">
          合并重复登记：逐项选择冲突形态值，并指定孢子印、鉴定留痕转到主条目，未采用观察随来源快照保留；
          拆分混采编号：生成至少两条带新采集编号的独立条目，原编号与字段留作来源。编号重复、来源互指或关联缺失时自动停止，原数据一律不改。
        </p>
      </div>
      <el-tag type="info" effect="plain">归档快照 {{ archivedCount }} 条 · 整理事件 {{ curationState.events.length }} 次</el-tag>
    </div>

    <el-tabs
      :model-value="activeTab"
      class="mode-tabs"
      @tab-change="(key: string | number) => switchTab(String(key) as 'merge' | 'split')"
    >
      <el-tab-pane label="合并重复条目" name="merge">
        <MergePanel @done="() => {}" />
      </el-tab-pane>
      <el-tab-pane label="拆分混采编号" name="split">
        <SplitPanel @done="() => {}" />
      </el-tab-pane>
    </el-tabs>

    <h3 class="section-title">整理历史（重开浏览器仍可追溯）</h3>
    <el-card shadow="never" class="history">
      <el-empty v-if="curationState.events.length === 0" description="尚无整理记录" />
      <el-timeline v-else>
        <el-timeline-item
          v-for="event in curationState.events"
          :key="event.id"
          :timestamp="`${event.date}${event.operator ? ' · ' + event.operator : ''}`"
          :type="event.kind === 'merge' ? 'primary' : 'warning'"
        >
          <router-link v-if="event.data.kind === 'merge'" class="hist-link" :to="`/atlas/${event.data.masterId}`">
            <el-tag size="small" type="primary" effect="plain">合并</el-tag>
            {{ event.data.sourceIds.map(recordLabel).join('、') }}
            → 主条目 {{ recordLabel(event.data.masterId) }}
          </router-link>
          <router-link v-else class="hist-link" :to="`/atlas/${event.data.resultIds[0]}`">
            <el-tag size="small" type="warning" effect="plain">拆分</el-tag>
            {{ recordLabel(event.data.sourceId) }}
            → {{ event.data.resultCodes.join('、') }}
          </router-link>
          <div class="muted">
            涉及孢子印 / 鉴定留痕 {{ event.data.attachments.length }} 项，原记录、孢子印与鉴定留痕快照已随事件保存。
          </div>
        </el-timeline-item>
      </el-timeline>
    </el-card>
  </div>
</template>

<style scoped>
.mode-tabs {
  background: #fff;
  border: 1px solid #e8e2d6;
  border-radius: 12px;
  padding: 8px 16px 4px;
}
.history {
  border-radius: 12px;
}
.hist-link {
  font-size: 13px;
  color: #2b3a2f;
  text-decoration: none;
}
.hist-link:hover {
  color: #c96f3a;
}
</style>
