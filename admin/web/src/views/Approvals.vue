<template>
  <div class="page">
    <div class="page-head">
      <div class="page-sub">开发者提交的修改会先出现在这里，管理员点「通过」之后才会真正执行</div>
      <div class="page-actions">
        <el-select v-model="status" style="width: 140px" @change="reload">
          <el-option label="待审核" value="pending" />
          <el-option label="全部" value="" />
          <el-option label="已执行" value="executed" />
          <el-option label="已驳回" value="rejected" />
        </el-select>
        <el-button @click="reload">刷新</el-button>
      </div>
    </div>

    <el-card shadow="never">
      <el-table :data="list" v-loading="loading" style="width: 100%">
        <el-table-column label="提交时间" width="160">
          <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column prop="requestedBy" label="提交人" width="120" />
        <el-table-column label="动作" width="180">
          <template #default="{ row }">{{ actionLabel(row.action) }}</template>
        </el-table-column>
        <el-table-column label="内容" min-width="240">
          <template #default="{ row }">
            <span class="payload">{{ payloadText(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="结果" width="130">
          <template #default="{ row }">{{ row.result || '-' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="170">
          <template #default="{ row }">
            <template v-if="row.status === 'pending'">
              <el-button size="small" type="primary" :loading="busy === row.id" @click="onApprove(row)">通过</el-button>
              <el-button size="small" text type="danger" @click="onReject(row)">驳回</el-button>
            </template>
            <span v-else class="done-text">已处理</span>
          </template>
        </el-table-column>
      </el-table>

      <div class="pager">
        <el-pagination
          layout="prev, pager, next, total"
          :current-page="page"
          :page-size="pageSize"
          :total="total"
          @current-change="(p) => { page = p; load() }"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { approveApproval, fetchApprovals, rejectApproval } from '../api.js'

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const busy = ref('')
const status = ref('pending')

const ACTION_LABEL = {
  'posts.remove': '删帖',
  'posts.setTop': '置顶 / 取消置顶',
  'comments.remove': '删评论',
  'reports.dismiss': '忽略举报',
  'reports.removePost': '举报删帖',
  'users.ban': '封禁用户',
  'users.unban': '解封用户',
  'feedback.resolve': '处理反馈',
  'feedback.remove': '删反馈',
  'announcements.create': '发公告',
  'announcements.update': '改公告',
  'announcements.remove': '删公告',
  'settings.set': '改运营配置',
  'trash.restore': '恢复回收站内容',
  'trash.purge': '彻底删除内容',
  'wordfilters.add': '加敏感词',
  'wordfilters.remove': '删敏感词',
  'backup.create': '创建备份',
  'backup.remove': '删备份',
  'users.setRole': '任免管理员',
}

const actionLabel = (a) => ACTION_LABEL[a] || a

const statusLabel = (s) => ({ pending: '待审核', approved: '执行中', executed: '已执行', failed: '执行失败', rejected: '已驳回' }[s] || s)
const statusType = (s) => ({ pending: 'warning', executed: 'success', failed: 'danger', rejected: 'info', approved: 'primary' }[s] || 'info')

const fmt = (ts) => {
  if (!ts) return '-'
  const d = new Date(Number(ts))
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function payloadText(row) {
  const p = row.payload || {}
  if (p.postId) return '帖子：' + p.postId.slice(-8)
  if (p.commentId) return '评论：' + p.commentId.slice(-8)
  if (p.word) return '词：' + p.word
  if (p.key) return '配置：' + p.key + ' = ' + String(p.value || '').slice(0, 30)
  if (p.id) return 'id：' + String(p.id).slice(-8)
  const keys = Object.keys(p)
  if (!keys.length) return '—'
  return keys
    .slice(0, 3)
    .map((k) => k + '=' + String(p[k]).slice(0, 20))
    .join('，')
}

async function load() {
  loading.value = true
  try {
    const res = await fetchApprovals(page.value, pageSize, status.value)
    if (res.ok) {
      list.value = res.list || []
      total.value = res.total || 0
    } else {
      ElMessage.error(res.msg || '加载失败')
    }
  } finally {
    loading.value = false
  }
}

function reload() {
  page.value = 1
  load()
}

onMounted(load)

async function onApprove(row) {
  try {
    await ElMessageBox.confirm('通过后这次修改会立刻执行，确定吗？', '通过审核', { type: 'warning' })
  } catch (err) {
    return
  }
  busy.value = row.id
  try {
    const res = await approveApproval(row.id)
    if (res.ok) ElMessage.success('已通过并执行')
    else ElMessage.error(res.msg || '执行失败')
    await load()
  } finally {
    busy.value = ''
  }
}

async function onReject(row) {
  let reason = ''
  try {
    const r = await ElMessageBox.prompt('写一句驳回原因（可留空）', '驳回', { inputPlaceholder: '比如：这个帖子还要留着' })
    reason = r.value || ''
  } catch (err) {
    return
  }
  const res = await rejectApproval(row.id, reason)
  if (res.ok) ElMessage.success('已驳回')
  else ElMessage.error(res.msg || '驳回失败')
  await load()
}
</script>

<style scoped>
.page {
  padding: 18px 22px 30px;
}

.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  gap: 16px;
}

.page-sub {
  color: var(--muted);
  font-size: 13px;
}

.page-actions {
  display: flex;
  gap: 10px;
}

.payload {
  color: #4b5563;
  font-size: 13px;
}

.done-text {
  color: var(--muted);
  font-size: 12px;
}

.pager {
  display: flex;
  justify-content: flex-end;
  padding-top: 12px;
}
</style>
