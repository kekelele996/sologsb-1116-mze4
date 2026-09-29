<script setup lang="ts">
import { computed } from 'vue'
import type { CollectPoint, FungusRecord } from '@/types'
import { FIELD_GROUPS, TRAIT_FIELDS, type EditableTraitKey, type TraitFieldMeta } from '@/utils/curation'

/** 拆分产物表单值：除 id / code / 整理状态字段外的全部形态字段 */
export type DraftFields = Omit<FungusRecord, 'id' | 'code' | 'status' | 'mergedIntoId' | 'splitFromId'>

const props = defineProps<{
  modelValue: DraftFields
  points: CollectPoint[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: DraftFields): void
}>()

const groups = computed(() =>
  FIELD_GROUPS.map((group) => ({
    ...group,
    fields: TRAIT_FIELDS.filter((field) => field.group === group.key)
  })).filter((group) => group.key !== 'base' || group.fields.some((field) => field.key !== 'pointId'))
)

/** pointId 的选项来自采集点表，不使用枚举默认值 */
function optionsOf(field: TraitFieldMeta): readonly string[] {
  if (field.key === 'pointId') return props.points.map((point) => point.id)
  return field.options ?? []
}

function labelOf(field: TraitFieldMeta, value: string | number): string {
  if (field.key === 'pointId') return props.points.find((point) => point.id === value)?.name ?? '未关联采集点'
  return String(value)
}

function patch(key: EditableTraitKey, value: string | number): void {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}
</script>

<template>
  <div class="draft-form">
    <template v-for="group in groups" :key="group.key">
      <div class="group-title">{{ group.title }}</div>
      <div class="grid">
        <label v-for="field in group.fields" :key="field.key" class="cell">
          <span class="lab">{{ field.label }}</span>
          <el-select
            v-if="field.kind === 'enum'"
            :model-value="String(modelValue[field.key])"
            :disabled="disabled"
            size="small"
            style="width: 100%"
            @update:model-value="(value: string) => patch(field.key, value)"
          >
            <el-option
              v-for="option in optionsOf(field)"
              :key="option"
              :label="labelOf(field, option)"
              :value="option"
            />
          </el-select>
          <el-input-number
            v-else-if="field.kind === 'number'"
            :model-value="Number(modelValue[field.key])"
            :disabled="disabled"
            :min="field.min ?? 0"
            :step="field.step ?? 1"
            :controls="false"
            size="small"
            style="width: 100%"
            @update:model-value="(value: number | undefined) => patch(field.key, Number(value ?? 0))"
          />
          <el-input
            v-else
            :model-value="String(modelValue[field.key] ?? '')"
            :disabled="disabled"
            size="small"
            @update:model-value="(value: string) => patch(field.key, value)"
          />
        </label>
      </div>
    </template>
  </div>
</template>

<style scoped>
.group-title {
  margin: 8px 0 6px;
  font-size: 12px;
  font-weight: 600;
  color: #8a6a3d;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
}
.cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.lab {
  font-size: 11px;
  color: #7a8896;
}
</style>
