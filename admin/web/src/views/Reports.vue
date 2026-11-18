<template>
  <div class="page">
    <div class="page-head">
      <div>
        <div class="page-sub">第 {{ page }} 页 · 每页 {{ pageSize }} 条举报 · 删掉的帖子会进回收站，可以恢复</div>
      </div>
      <el-button :loading="loading" @click="load(page)">刷新</el-button>
    </div>

    <div class="card">
      <el-table :data="list" v-loading="loading" size="large" empty-text="暂时没有举报">
        <el-table-column label="理由" width="110">
          <template #default="{ row }">
            <span class="tag-reason">{{ row.reason }}</span>
          </template>
        </el-table-column>
        <el-table-column label="被举报内容" min-width="320">
          <template #default="{ row }">
            <div v-if="row.post">
              <div class="clamp-2">{{ row.post.content }}</div>
              <div class="muted" style="margin-top: 4px">
                {{ row.post.nickname || '匿名同学' }}
                <span v-if="row.post.images && row.post.images.length">· {{ row.post.images.length }} 张图</span>
              </div>
            </div>
            <span v-else class="muted">（帖子已经被删除了）</span>
          </template>
        </el-table-column>
        <el-table-column label="举报时间" width="150">
          <template #default="{ row }">{{ time(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200" align="right">
          <template #default="{ row }">
            <el-button size="small" :disabled="!row.post" @click="onDismiss(row)">忽略</el-button>
            <el-button size="small" type="danger" :disabled="!row.post" @click="onRemove(row)">删帖子</el-button>
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
import { dismissReport, fetchReports, removeReportedPost } from '../api.js'

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
    const r = await fetchReports(p, pageSize)
    if (!r || r.ok === false) {
      ElMessage.error((r && r.msg) || '加载失败')
      return
    }
    list.value = r.list || []
    hasMore.value = !!r.hasMore
    page.value = r.page || p
  } catch (err) {
    ElMessage.error('连不上云开发：' + (err.message || err))
  } finally {
    loading.value = false
  }
}

async function onDismiss(row) {
  try {
    await ElMessageBox.confirm('忽略这条举报？不会删除帖子。', '忽略举报', { type: 'info' })
  } catch (err) {
    return
  }
  const r = await dismissReport(row.id)
  if (r && r.ok) {
    ElMessage.success('已忽略')
    load(page.value)
  } else {
    ElMessage.error((r && r.msg) || '操作失败')
  }
}

async function onRemove(row) {
  try {
    await ElMessageBox.confirm('会删掉这条帖子，并给举报人发一条通知。删掉的帖子在「回收站」里可以恢复。', '删除帖子', {
      type: 'warning',
      confirmButtonText: '删除',
      confirmButtonClass: 'el-button--danger',
    })
  } catch (err) {
    return
  }
  const r = await removeReportedPost(row.postId)
  if (r && r.ok) {
    ElMessage.success('已删除，帖子进了回收站')
    load(page.value)
  } else {
    ElMessage.error((r && r.msg) || '操作失败')
  }
}

onMounted(() => load(1))
</script>
