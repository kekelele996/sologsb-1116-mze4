<script setup lang="ts">
import { computed } from 'vue'
import type { IdentifyLog, SporePrint } from '@/types'
import SporePrintSwatch from './SporePrintSwatch.vue'

/** 可分配去向的条目选项：value=条目 id */
interface TargetOption {
  value: string
  label: string
  /** 是否为归档快照（仅允许「保留在来源」时选择） */
  archived?: boolean
}

const props = defineProps<{
  spores: SporePrint[]
  identifies: IdentifyLog[]
  /** key: 关联项 id -> 目标条目 id */
  modelValue: Record<string, string>
  options: TargetOption[]
  /** 默认去向（合并：主条目；拆分：来源自身），用于列说明 */
  defaultLabel: string
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: Record<string, string>): void
}>()

const rows = computed(() => {
  const sporeRows = props.spores.map((spore) => ({
    itemId: spore.id,
    kind: 'spore' as const,
    ownerId: spore.recordId,
    summary: `${spore.shape || '印形未记'} · ${spore.hours}h · ${spore.observeDate}`,
    sub: spore.moisture || '干湿度未记'
  }))
  const logRows = props.identifies.map((log) => ({
    itemId: log.id,
    kind: 'identify' as const,
    ownerId: log.recordId,
    summary: log.conclusion,
    sub: `${log.basis} · 置信度${log.confidence}${log.needReview ? ' · 待复核' : ''} · ${log.date}`
  }))
  return [...sporeRows, ...logRows]
})

function optionLabel(ownerId: string): string {
  return props.options.find((option) => option.value === ownerId)?.label ?? ownerId
}

function assign(itemId: string, target: string): void {
  emit('update:modelValue', { ...props.modelValue, [itemId]: target })
}
</script>

<template>
  <el-table :data="rows" border size="small" empty-text="所选条目暂无孢子印或鉴定留痕">
    <el-table-column label="类型" width="92">
      <template #default="{ row }">
        <el-tag :type="row.kind === 'spore' ? 'primary' : 'success'" size="small" effect="plain">
          {{ row.kind === 'spore' ? '孢子印' : '鉴定留痕' }}
        </el-tag>
      </template>
    </el-table-column>
    <el-table-column label="内容摘要" min-width="220">
      <template #default="{ row }">
        <template v-if="row.kind === 'spore'">
          <SporePrintSwatch
            :color="spores.find((spore) => spore.id === row.itemId)?.color ?? null"
            :caption="row.summary"
          />
        </template>
        <template v-else>
          <div>{{ row.summary }}</div>
          <div class="muted">{{ row.sub }}</div>
        </template>
      </template>
    </el-table-column>
    <el-table-column label="现属条目" width="190">
      <template #default="{ row }">
        <span class="mono">{{ optionLabel(row.ownerId) }}</span>
      </template>
    </el-table-column>
    <el-table-column :label="`整理后去向（默认：${defaultLabel}）`" width="240">
      <template #default="{ row }">
        <el-select
          :model-value="modelValue[row.itemId] ?? row.ownerId"
          size="small"
          style="width: 100%"
          @update:model-value="(value: string) => assign(row.itemId, value)"
        >
          <el-option
            v-for="option in options"
            :key="option.value"
            :label="option.archived ? `${option.label}（来源快照）` : option.label"
            :value="option.value"
          />
        </el-select>
      </template>
    </el-table-column>
  </el-table>
</template>
