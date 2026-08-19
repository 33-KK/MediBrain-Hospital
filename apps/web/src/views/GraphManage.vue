<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { graphApi, type GraphNode, type GraphRelationRow } from '@/api'

const activeTab = ref<'nodes' | 'relations'>('nodes')

// ---- 元数据 ----
const meta = reactive({ labels: [] as string[], relationTypes: [] as string[] })

// ---- 节点 ----
const nodeLoading = ref(false)
const nodes = ref<GraphNode[]>([])
const nodeTotal = ref(0)
const nodeQuery = reactive({ label: '', kw: '', page: 1, pageSize: 10 })

const nodeDialog = reactive({
  visible: false,
  isEdit: false,
  saving: false,
  label: '疾病',
  name: '',
  props: [] as { key: string; value: string }[],
})

// ---- 关系 ----
const relLoading = ref(false)
const rels = ref<GraphRelationRow[]>([])
const relTotal = ref(0)
const relQuery = reactive({ kw: '', page: 1, pageSize: 10 })

const relDialog = reactive({
  visible: false,
  saving: false,
  type: '疾病宜吃食物',
  fromLabel: '疾病',
  fromName: '',
  toLabel: '食物',
  toName: '',
})

async function loadMeta() {
  const res = await graphApi.meta()
  meta.labels = res.labels
  meta.relationTypes = res.relationTypes
}

async function loadNodes() {
  nodeLoading.value = true
  try {
    const res = await graphApi.nodes({
      ...nodeQuery,
      label: nodeQuery.label || undefined,
      kw: nodeQuery.kw || undefined,
    })
    nodes.value = res.list
    nodeTotal.value = res.total
  } finally {
    nodeLoading.value = false
  }
}

async function loadRels() {
  relLoading.value = true
  try {
    const res = await graphApi.relations({
      ...relQuery,
      kw: relQuery.kw || undefined,
    })
    rels.value = res.list
    relTotal.value = res.total
  } finally {
    relLoading.value = false
  }
}

function openCreateNode() {
  nodeDialog.visible = true
  nodeDialog.isEdit = false
  nodeDialog.label = meta.labels[0] || '疾病'
  nodeDialog.name = ''
  nodeDialog.props = [{ key: '名称', value: '' }, { key: '简介', value: '' }]
}

function openEditNode(row: GraphNode) {
  nodeDialog.visible = true
  nodeDialog.isEdit = true
  nodeDialog.label = row.label
  nodeDialog.name = row.name
  nodeDialog.props = Object.entries(row.properties).map(([k, v]) => ({ key: k, value: String(v) }))
}

function addPropRow() {
  nodeDialog.props.push({ key: '', value: '' })
}

function removePropRow(i: number) {
  nodeDialog.props.splice(i, 1)
}

async function saveNode() {
  const props = Object.fromEntries(
    nodeDialog.props.filter((p) => p.key.trim()).map((p) => [p.key.trim(), p.value])
  )
  if (!props['名称']) {
    ElMessage.warning('请填写"名称"属性')
    return
  }
  nodeDialog.saving = true
  try {
    if (nodeDialog.isEdit) {
      await graphApi.updateNode({ label: nodeDialog.label, name: nodeDialog.name, properties: props })
      ElMessage.success('节点已更新')
    } else {
      await graphApi.createNode({ label: nodeDialog.label, properties: props })
      ElMessage.success('节点已创建')
    }
    nodeDialog.visible = false
    loadNodes()
  } finally {
    nodeDialog.saving = false
  }
}

async function removeNode(row: GraphNode) {
  await ElMessageBox.confirm(`确定删除节点「${row.label}/${row.name}」？其所有关联关系将一并删除。`, '删除确认', {
    type: 'warning',
  })
  const res = await graphApi.deleteNode({ label: row.label, name: row.name })
  if (!res.deleted) {
    ElMessage.warning('节点不存在，可能已被删除')
  } else {
    ElMessage.success('节点已删除')
  }
  loadNodes()
}

async function saveRelation() {
  if (!relDialog.fromName || !relDialog.toName) {
    ElMessage.warning('请填写起点和终点名称')
    return
  }
  relDialog.saving = true
  try {
    await graphApi.createRelation({
      type: relDialog.type,
      fromLabel: relDialog.fromLabel,
      fromName: relDialog.fromName,
      toLabel: relDialog.toLabel,
      toName: relDialog.toName,
    })
    ElMessage.success('关系已创建')
    relDialog.visible = false
    loadRels()
  } finally {
    relDialog.saving = false
  }
}

async function removeRelation(row: GraphRelationRow) {
  await ElMessageBox.confirm(
    `确定删除关系「${row.from} -[${row.type}]-> ${row.to}」？`,
    '删除确认',
    { type: 'warning' }
  )
  const res = await graphApi.deleteRelation({
    type: row.type,
    fromLabel: row.fromLabel,
    fromName: row.from,
    toLabel: row.toLabel,
    toName: row.to,
  })
  if (!res.deleted) {
    ElMessage.warning('关系不存在，可能已被删除')
  } else {
    ElMessage.success('关系已删除')
  }
  loadRels()
}

function onTabChange() {
  if (activeTab.value === 'relations') loadRels()
}

onMounted(async () => {
  await loadMeta()
  loadNodes()
})
</script>

<template>
  <el-card shadow="never">
    <template #header>
      <div class="header-row">
        <span>图谱数据管理</span>
        <el-tag size="small" type="warning">仅管理员 / 医生可操作</el-tag>
      </div>
    </template>

    <el-tabs v-model="activeTab" @tab-change="onTabChange">
      <!-- ===== 节点管理 ===== -->
      <el-tab-pane label="节点管理" name="nodes">
        <div class="toolbar">
          <el-select v-model="nodeQuery.label" placeholder="全部标签" clearable style="width: 140px" @change="nodeQuery.page = 1; loadNodes()">
            <el-option v-for="l in meta.labels" :key="l" :label="l" :value="l" />
          </el-select>
          <el-input
            v-model="nodeQuery.kw"
            placeholder="按名称搜索"
            clearable
            style="width: 240px"
            @keyup.enter="nodeQuery.page = 1; loadNodes()"
          />
          <el-button type="primary" @click="nodeQuery.page = 1; loadNodes()">查询</el-button>
          <el-button type="success" @click="openCreateNode">新增节点</el-button>
        </div>

        <el-table :data="nodes" v-loading="nodeLoading" stripe class="table">
          <el-table-column prop="name" label="名称" min-width="160" show-overflow-tooltip />
          <el-table-column prop="label" label="标签" width="110">
            <template #default="{ row }">
              <el-tag size="small">{{ row.label }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="属性" min-width="260">
            <template #default="{ row }">
              <span class="props-text">
                {{ Object.entries(row.properties).filter(([k]) => k !== '名称').map(([k, v]) => `${k}: ${String(v).slice(0, 30)}`).join('；') || '—' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-button size="small" @click="openEditNode(row)">编辑</el-button>
              <el-button size="small" type="danger" @click="removeNode(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>

        <el-pagination
          v-model:current-page="nodeQuery.page"
          :page-size="nodeQuery.pageSize"
          :total="nodeTotal"
          layout="total, prev, pager, next"
          class="pager"
          @current-change="loadNodes"
        />
      </el-tab-pane>

      <!-- ===== 关系管理 ===== -->
      <el-tab-pane label="关系管理" name="relations">
        <div class="toolbar">
          <el-input
            v-model="relQuery.kw"
            placeholder="按节点名/关系类型搜索"
            clearable
            style="width: 260px"
            @keyup.enter="relQuery.page = 1; loadRels()"
          />
          <el-button type="primary" @click="relQuery.page = 1; loadRels()">查询</el-button>
          <el-button type="success" @click="relDialog.visible = true">新增关系</el-button>
        </div>

        <el-table :data="rels" v-loading="relLoading" stripe class="table">
          <el-table-column label="起点" min-width="140" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.from }} <el-tag size="small" type="info">{{ row.fromLabel }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="关系类型" width="140">
            <template #default="{ row }">
              <el-tag size="small" type="warning">-{{ row.type }}-></el-tag>
            </template>
          </el-table-column>
          <el-table-column label="终点" min-width="140" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.to }} <el-tag size="small" type="info">{{ row.toLabel }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="90" fixed="right">
            <template #default="{ row }">
              <el-button size="small" type="danger" @click="removeRelation(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>

        <el-pagination
          v-model:current-page="relQuery.page"
          :page-size="relQuery.pageSize"
          :total="relTotal"
          layout="total, prev, pager, next"
          class="pager"
          @current-change="loadRels"
        />
      </el-tab-pane>
    </el-tabs>

    <!-- ===== 节点新增/编辑对话框 ===== -->
    <el-dialog
      v-model="nodeDialog.visible"
      :title="nodeDialog.isEdit ? '编辑节点' : '新增节点'"
      width="560px"
    >
      <el-form label-width="90px">
        <el-form-item label="标签">
          <el-select v-model="nodeDialog.label" :disabled="nodeDialog.isEdit" style="width: 100%">
            <el-option v-for="l in meta.labels" :key="l" :label="l" :value="l" />
          </el-select>
        </el-form-item>
        <el-form-item v-for="(p, i) in nodeDialog.props" :key="i" :label="p.key === '名称' ? '名称 *' : '属性'">
          <div class="prop-row">
            <el-input v-model="p.key" placeholder="属性名" style="width: 140px" />
            <el-input v-model="p.value" placeholder="属性值" style="width: 220px" />
            <el-button v-if="p.key !== '名称'" circle size="small" type="danger" @click="removePropRow(i)">
              <el-icon><Delete /></el-icon>
            </el-button>
          </div>
        </el-form-item>
        <el-form-item>
          <el-button size="small" @click="addPropRow">添加属性</el-button>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="nodeDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="nodeDialog.saving" @click="saveNode">保存</el-button>
      </template>
    </el-dialog>

    <!-- ===== 关系新增对话框 ===== -->
    <el-dialog v-model="relDialog.visible" title="新增关系" width="520px">
      <el-form label-width="90px">
        <el-form-item label="关系类型">
          <el-select v-model="relDialog.type" style="width: 100%">
            <el-option v-for="t in meta.relationTypes" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="起点">
          <div class="prop-row">
            <el-select v-model="relDialog.fromLabel" style="width: 110px">
              <el-option v-for="l in meta.labels" :key="l" :label="l" :value="l" />
            </el-select>
            <el-input v-model="relDialog.fromName" placeholder="起点节点名称" style="width: 260px" />
          </div>
        </el-form-item>
        <el-form-item label="终点">
          <div class="prop-row">
            <el-select v-model="relDialog.toLabel" style="width: 110px">
              <el-option v-for="l in meta.labels" :key="l" :label="l" :value="l" />
            </el-select>
            <el-input v-model="relDialog.toName" placeholder="终点节点名称" style="width: 260px" />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="relDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="relDialog.saving" @click="saveRelation">保存</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<style scoped>
.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.toolbar {
  display: flex;
  gap: 10px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.table {
  width: 100%;
}

.props-text {
  font-size: 13px;
  color: #606266;
}

.prop-row {
  display: flex;
  gap: 8px;
  width: 100%;
  align-items: center;
}

.pager {
  margin-top: 14px;
  justify-content: flex-end;
}
</style>