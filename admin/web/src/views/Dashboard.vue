<template>
  <div class="page">
    <div class="page-head">
      <div>
        <div class="page-sub">今天圈子里发生的事，一眼看完</div>
      </div>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">帖子总数</div>
        <div class="stat-value">{{ data.posts ?? '—' }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">评论总数</div>
        <div class="stat-value">{{ data.comments ?? '—' }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">用户数</div>
        <div class="stat-value">{{ data.users ?? '—' }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">互助订单</div>
        <div class="stat-value">{{ data.orders ?? '—' }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">待处理举报</div>
        <div class="stat-value warn">{{ data.pendingReports ?? '—' }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">待处理反馈</div>
        <div class="stat-value warn">{{ data.pendingFeedback ?? '—' }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">回收站</div>
        <div class="stat-value">{{ data.trashCount ?? '—' }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">敏感词</div>
        <div class="stat-value">{{ data.wordCount ?? '—' }}</div>
      </div>
    </div>

    <div class="card" style="margin-top: 18px">
      <div class="block-head">
        <span>最近举报</span>
        <el-button text type="primary" @click="$router.push('/reports')">查看全部 →</el-button>
      </div>
      <el-table :data="data.recentReports || []" size="large" empty-text="暂时没有举报，圈子很干净">
        <el-table-column label="理由" width="110">
          <template #default="{ row }">
            <span class="tag-reason">{{ row.reason }}</span>
          </template>
        </el-table-column>
        <el-table-column label="被举报内容">
          <template #default="{ row }">
            <div class="clamp-2">{{ (row.post && row.post.content) || '（帖子已删除）' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="作者" width="140">
          <template #default="{ row }">{{ (row.post && row.post.nickname) || '—' }}</template>
        </el-table-column>
        <el-table-column label="时间" width="120">
          <template #default="{ row }">{{ time(row.createdAt) }}</template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { fetchDashboard } from '../api.js'

const data = reactive({})
const loading = ref(false)

function time(ms) {
  if (!ms) return '—'
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function load() {
  loading.value = true
  try {
    const r = await fetchDashboard()
    if (!r || r.ok === false) {
      ElMessage.error((r && r.msg) || '加载失败')
      return
    }
    Object.assign(data, r)
  } catch (err) {
    ElMessage.error('连不上云开发：' + (err.message || err))
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  margin-bottom: 10px;
}
</style>
