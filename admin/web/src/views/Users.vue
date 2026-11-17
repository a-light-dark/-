<template>
  <div class="page">
    <div class="page-head">
      <div>
        <div class="page-sub">共 {{ total }} 位同学 · 封禁后对方发帖/评论/悬赏/抢单/点赞都会被拒</div>
      </div>
      <div style="display: flex; gap: 10px">
        <el-input v-model="keyword" placeholder="搜昵称" clearable style="width: 220px" @keyup.enter="load(1)" />
        <el-button type="primary" :loading="loading" @click="load(1)">搜索</el-button>
      </div>
    </div>

    <div class="card">
      <el-table :data="list" v-loading="loading" size="large" empty-text="没有找到同学">
        <el-table-column label="同学" min-width="220">
          <template #default="{ row }">
            <div class="cell-main">
              <span class="avatar">{{ row.avatar || '😀' }}</span>
              <div>
                <div>{{ row.nickname || '未设置昵称' }}</div>
                <div class="muted">{{ row.openid.slice(-8) }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="身份" width="160">
          <template #default="{ row }">
            <el-tag v-if="row.role === 'admin'" size="small" type="success">管理员</el-tag>
            <el-tag v-else-if="row.openid === ownerOpenid" size="small">圈主</el-tag>
            <span v-else class="muted">普通同学</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="200">
          <template #default="{ row }">
            <el-tag v-if="row.banned" size="small" type="danger">已封禁</el-tag>
            <span v-if="row.banned" class="muted" style="margin-left: 6px">{{ row.banReason || '未填原因' }}</span>
            <span v-if="!row.banned" class="muted">正常</span>
          </template>
        </el-table-column>
        <el-table-column label="注册时间" width="130">
          <template #default="{ row }">{{ time(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="300" align="right">
          <template #default="{ row }">
            <el-button v-if="!row.banned" size="small" @click="onBan(row)">封禁</el-button>
            <el-button v-else size="small" type="success" plain @click="onUnban(row)">解封</el-button>
            <el-button
              v-if="isOwner && row.role !== 'admin' && row.openid !== ownerOpenid"
              size="small"
              @click="onSetRole(row, 'admin')"
            >
              设为管理员
            </el-button>
            <el-button v-if="isOwner && row.role === 'admin'" size="small" @click="onSetRole(row, '')">
              取消管理员
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pager">
        <el-pagination
          layout="prev, pager, next, total"
          :total="total"
          :page-size="pageSize"
          :current-page="page"
          @current-change="load"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { banUser, fetchIsAdmin, fetchUsers, setUserRole, unbanUser } from '../api.js'

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const keyword = ref('')
const isOwner = ref(false)
const ownerOpenid = ref('')

function time(ms) {
  if (!ms) return '—'
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

async function load(p = 1) {
  loading.value = true
  try {
    const r = await fetchUsers(p, pageSize, keyword.value)
    if (!r || r.ok === false) {
      ElMessage.error((r && r.msg) || '加载失败')
      return
    }
    list.value = r.list || []
    total.value = r.total || 0
    page.value = p
  } catch (err) {
    ElMessage.error('连不上云开发：' + (err.message || err))
  } finally {
    loading.value = false
  }
}

async function onBan(row) {
  let reason = ''
  try {
    const res = await ElMessageBox.prompt(
      `封禁后「${row.nickname}」不能发帖、评论、发悬赏、抢单、点赞，填写原因（会展示在后台）：`,
      '封禁同学',
      { inputPlaceholder: '例如：发布违规广告', confirmButtonText: '封禁', confirmButtonClass: 'el-button--danger' }
    )
    reason = res.value || ''
  } catch (err) {
    return
  }
  const r = await banUser(row.openid, reason)
  if (r && r.ok) {
    ElMessage.success('已封禁')
    load(page.value)
  } else {
    ElMessage.error((r && r.msg) || '操作失败')
  }
}

async function onUnban(row) {
  const r = await unbanUser(row.openid)
  if (r && r.ok) {
    ElMessage.success('已解封')
    load(page.value)
  } else {
    ElMessage.error((r && r.msg) || '操作失败')
  }
}

async function onSetRole(row, role) {
  try {
    await ElMessageBox.confirm(
      role ? `把「${row.nickname}」设为管理员？他可以处理举报、管帖子，但不能封管理员。` : `取消「${row.nickname}」的管理员身份？`,
      role ? '设为管理员' : '取消管理员',
      { type: 'warning' }
    )
  } catch (err) {
    return
  }
  const r = await setUserRole(row.openid, role)
  if (r && r.ok) {
    ElMessage.success('已更新')
    load(page.value)
  } else {
    ElMessage.error((r && r.msg) || '操作失败')
  }
}

onMounted(async () => {
  try {
    const me = await fetchIsAdmin()
    isOwner.value = !!(me && me.owner)
  } catch (err) {
    isOwner.value = false
  }
  await load(1)
})
</script>
