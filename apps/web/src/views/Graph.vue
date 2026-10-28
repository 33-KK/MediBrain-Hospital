<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { GraphChart, type GraphSeriesOption } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
echarts.use([GraphChart, TooltipComponent, CanvasRenderer])
import { ElMessage } from 'element-plus'
import { qaApi } from '@/api'
import { useRouter } from 'vue-router'

const router = useRouter()
const chartRef = ref<HTMLElement>()
const diseaseName = ref('')
const searching = ref(false)
const stats = ref<{ nodes: number; edges: number }>({ nodes: 0, edges: 0 })

let chart: echarts.ECharts | null = null
const nodeLabels = new Map<string, string>()

const TYPE_COLORS: Record<string, string> = {
  疾病: '#f56c6c',
  食物: '#67c23a',
  药品: '#409eff',
  检查项目: '#e6a23c',
  疾病症状: '#909399',
  科目: '#9c27b0',
  治疗方法: '#00bcd4',
  药品商: '#8d6e63',
  default: '#607d8b',
}

async function search() {
  const name = diseaseName.value.trim()
  if (!name) {
    ElMessage.warning('请输入疾病名称')
    return
  }
  searching.value = true
  try {
    const res = await qaApi.disease(name)
    if (!res || !res.disease) {
      chart?.clear()
      stats.value = { nodes: 0, edges: 0 }
      ElMessage.warning(`图谱中未找到疾病「${name}」`)
      return
    }
    renderGraph(res)
  } catch {
    /* 拦截器已提示 */
  } finally {
    searching.value = false
  }
}

function renderGraph(res: any) {
  if (!chart) return
  nodeLabels.clear()
  const rootId = `疾病:${res.disease.name}`
  nodeLabels.set(rootId, '疾病')

  const nodes: GraphSeriesOption['data'] = [
    {
      id: rootId,
      name: res.disease.name,
      symbolSize: 60,
      itemStyle: { color: TYPE_COLORS['疾病'] },
      label: { show: true, fontSize: 14, fontWeight: 'bold' },
    },
  ]
  const links: GraphSeriesOption['links'] = []
  const seen = new Set<string>([rootId])
  const seenLinks = new Set<string>()

  for (const rel of res.relations) {
    const nodeId = `${rel.label || 'unknown'}:${rel.entity}`
    if (!seen.has(nodeId)) {
      seen.add(nodeId)
      nodeLabels.set(nodeId, rel.label || 'unknown')
      nodes.push({
        id: nodeId,
        name: rel.entity,
        symbolSize: 28,
        itemStyle: { color: TYPE_COLORS[rel.label || 'default'] || TYPE_COLORS.default },
        label: { show: true, fontSize: 10 },
      })
    }
    const edgeId = JSON.stringify([rootId, rel.relation, nodeId])
    if (seenLinks.has(edgeId)) continue
    seenLinks.add(edgeId)
    links.push({
      source: rootId,
      target: nodeId,
      label: { show: true, formatter: rel.relation, fontSize: 10 },
      lineStyle: { color: '#a0a4ad' },
    })
  }
  stats.value = { nodes: nodes.length, edges: links.length }

  chart.setOption({
    tooltip: {
      renderMode: 'richText',
      formatter: (p: any) =>
        p.dataType === 'node' ? `${p.data.name}` : `${p.data.source} --${p.data.label?.formatter}--> ${p.data.target}`,
    },
    series: [
      {
        type: 'graph',
        layout: 'force',
        layoutAnimation: false,
        roam: true,
        draggable: true,
        data: nodes,
        links,
        force: {
          repulsion: 400,
          edgeLength: 120,
          gravity: 0.1,
          friction: 0.6,
        },
        label: { show: true },
        emphasis: {
          focus: 'adjacency',
          lineStyle: { width: 2 },
        },
        lineStyle: {
          color: '#a0a4ad',
          width: 1.2,
          curveness: 0.1,
        },
        animationDuration: 300,
        animationDurationUpdate: 0,
      },
    ],
  })
}

function goDetail(name: string) {
  router.push({ path: '/disease', query: { name } })
}

watch(chartRef, (el) => {
  if (el && !chart) {
    chart = echarts.init(el)
    chart.on('click', (p: any) => {
      if (p.dataType === 'node' && nodeLabels.get(p.data.id) === '疾病') {
        goDetail(p.data.name)
      }
    })
    window.addEventListener('resize', resize)
  }
})

function resize() {
  chart?.resize()
}

onMounted(() => {
  if (diseaseName.value.trim()) nextTick(() => { void search() })
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize)
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div class="graph-page">
    <div class="toolbar">
      <el-input
        v-model="diseaseName"
        placeholder="输入疾病名称查看知识图谱，如：高血压"
        size="large"
        clearable
        @keyup.enter="search"
      >
        <template #prepend>疾病</template>
      </el-input>
      <el-button type="primary" size="large" :loading="searching" @click="search">
        查询图谱
      </el-button>
    </div>

    <div class="chart-wrap">
      <div v-if="stats.nodes > 0" class="stats">
        <el-tag type="success" effect="plain">{{ stats.nodes }} 个节点</el-tag>
        <el-tag type="warning" effect="plain">{{ stats.edges }} 条关系</el-tag>
      </div>
      <div ref="chartRef" class="chart"></div>
      <div class="legend">
        <span v-for="(color, type) in TYPE_COLORS" :key="type" class="legend-item">
          <span class="legend-dot" :style="{ background: color }"></span>{{ type }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.graph-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

.toolbar {
  display: flex;
  gap: 12px;
}

.chart-wrap {
  flex: 1;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  position: relative;
  min-height: 400px;
}

.chart {
  width: 100%;
  height: 100%;
  min-height: 400px;
}

.stats {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 10;
  display: flex;
  gap: 8px;
}

.legend {
  position: absolute;
  bottom: 12px;
  left: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12px;
  color: #606266;
  background: rgba(255, 255, 255, 0.85);
  padding: 6px 10px;
  border-radius: 6px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}
</style>
