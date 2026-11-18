<template>
  <div class="page">
    <div class="page-head">
      <div>
        <div class="page-sub">第 {{ page }} 页 · 每页 {{ pageSize }} 条 · 标记已处理会给提交人发一条系统消息（文案在「运营配置」里改）</div>
      </div>
      <el-button :loading="loading" @click="load(page)">刷新</el-button>
    </div>

    <div class="card">
      <el-table :data="list" v-loading="loading" size="large" empty-text="还没有收到建议">
        <el-table-column label="内容" min-width="360">
          <template #default="{ row }">
            <div class="clamp-2">{{ row.content }}</div>
            <div class="muted" style="margin-top: 4px">
              {{ row.nickname || '匿名同学' }}
              <span v-if="row.contact">· 联系方式 {{ row.contact }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="row.done ? 'success' : 'warning'" size="small">{{ row.status || '待处理' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="150">
          <template #default="{ row }">{{ row.time || time(row.ts) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="220" align="right">
          <template #default="{ row }">
            <el-button size="small" :disabled="row.done" @click="onResolve(row)">标记已处理</el-button>
            <el-button size="small" type="danger" plain @click="onRemove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pager">
        <el-pagination
          layout="prev, next"
          :total="pagerTotal"
          :page-size="pageSize"
          :current-page="page"
          @current-change="load"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { fetchFeedback, removeFeedback, resolveFeedback } from '../api.js'

const list = ref([])
const hasMore = ref(false)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const pagerTotal = computed(() => (page.value - 1) * pageSize + list.value.length + (hasMore.value ? 1 : 0))

function time(ms) {
  if (!ms) return '—'
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function load(p = 1) {
  loading.value = true
  try {
    const r = await fetchFeedback(p, pageSize)
    if (!r || r.ok === false) {
      ElMessage.error((r && r.msg) || '加载失败')
      return
    }
    list.value = r.list || []
    hasMore.value = !!r.hasMore
    page.value = p
  } catch (err) {
    ElMessage.error('连不上云开发：' + (err.message || err))
  } finally {
    loading.value = false
  }
}

async function onResolve(row) {
  const r = await resolveFeedback(row.id)
  if (r && r.ok) {
    ElMessage.success('已标记，会给对方发一条系统消息')
    load(page.value)
  } else {
    ElMessage.error((r && r.msg) || '操作失败')
  }
}

async function onRemove(row) {
  try {
    await ElMessageBox.confirm('删除这条建议？删掉就找不回来了。', '删除建议', { type: 'warning' })
  } catch (err) {
    return
  }
  const r = await removeFeedback(row.id)
  if (r && r.ok) {
    ElMessage.success('已删除')
    load(page.value)
  } else {
    ElMessage.error((r && r.msg) || '操作失败')
  }
}

onMounted(() => load(1))
</script>
