<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { qaApi } from '@/api'

const route = useRoute()
const router = useRouter()

const diseaseName = ref<string>((route.query.name as string) || '')
const loading = ref(false)
const data = ref<any>(null)

const RELATION_LABELS: Record<string, { label: string; color: string }> = {
  症状: { label: '症状', color: '#909399' },
  宜吃食物: { label: '宜吃食物', color: '#67C23A' },
  忌吃食物: { label: '忌吃食物', color: '#F56C6C' },
  常用药品: { label: '常用药品', color: '#409EFF' },
  所需检查: { label: '所需检查', color: '#E6A23C' },
  并发症: { label: '并发症', color: '#F56C6C' },
  所属科目: { label: '所属科目', color: '#9C27B0' },
  治疗方法: { label: '治疗方法', color: '#00BCD4' },
}

const relationOrder = Object.keys(RELATION_LABELS)

async function load(name: string) {
  if (!name) return
  loading.value = true
  data.value = null
  try {
    data.value = await qaApi.disease(name)
  } catch {
    /* 拦截器已提示 */
  } finally {
    loading.value = false
  }
}

function groupedRelations() {
  if (!data.value) return []
  const map = new Map<string, any[]>()
  for (const rel of data.value.relations) {
    if (!map.has(rel.relation)) map.set(rel.relation, [])
    map.get(rel.relation)!.push(rel)
  }
  return [...map.entries()]
    .sort((a, b) => relationOrder.indexOf(a[0]) - relationOrder.indexOf(b[0]))
    .map(([relation, items]) => ({
      relation,
      items,
      meta: RELATION_LABELS[relation] || { label: relation, color: '#607D8B' },
    }))
}

onMounted(() => load(diseaseName.value))

watch(
  () => route.query.name,
  (v) => {
    diseaseName.value = (v as string) || ''
    load(diseaseName.value)
  },
)
</script>

<template>
  <div v-loading="loading" class="disease-page">
    <div class="toolbar">
      <el-input
        v-model="diseaseName"
        placeholder="输入疾病名称，如：冠心病"
        size="large"
        clearable
        @keyup.enter="router.replace({ query: { name: diseaseName } })"
      >
        <template #prepend>疾病</template>
      </el-input>
      <el-button
        type="primary"
        size="large"
        @click="router.replace({ query: { name: diseaseName } })"
      >
        查询
      </el-button>
    </div>

    <el-empty v-if="!loading && !data" description="请输入疾病名称查询详情" />

    <template v-if="data">
      <el-card class="disease-card" shadow="never">
        <template #header>
          <div class="card-header">
            <span class="disease-name">{{ data.disease.name }}</span>
            <el-tag type="danger">疾病</el-tag>
          </div>
        </template>
        <p class="desc">{{ data.disease.desc || '暂无简介' }}</p>
      </el-card>

      <div class="relations">
        <el-card
          v-for="group in groupedRelations()"
          :key="group.relation"
          class="relation-card"
          shadow="never"
        >
          <template #header>
            <div class="relation-header">
              <span class="relation-title" :style="{ color: group.meta.color }">
                {{ group.meta.label }}
              </span>
              <el-tag size="small" type="info" effect="plain">{{ group.items.length }}</el-tag>
            </div>
          </template>
          <div class="relation-items">
            <el-tag
              v-for="item in group.items"
              :key="item.entity"
              class="relation-item"
              :color="group.meta.color + '14'"
              :style="{ color: group.meta.color, borderColor: group.meta.color + '44' }"
              effect="light"
            >
              {{ item.entity }}
            </el-tag>
          </div>
        </el-card>
      </div>
    </template>
  </div>
</template>

<style scoped>
.disease-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.toolbar {
  display: flex;
  gap: 12px;
}

.disease-card :deep(.el-card__header) {
  padding: 14px 20px;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.disease-name {
  font-size: 20px;
  font-weight: 700;
  color: #303133;
}

.desc {
  color: #606266;
  line-height: 1.8;
  font-size: 14px;
}

.relations {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 16px;
}

.relation-card :deep(.el-card__header) {
  padding: 12px 16px;
}

.relation-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.relation-title {
  font-size: 15px;
  font-weight: 600;
}

.relation-items {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.relation-item {
  cursor: default;
  font-size: 13px;
}
</style>
