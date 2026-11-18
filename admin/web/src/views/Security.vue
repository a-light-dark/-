<template>
  <div class="page">
    <div class="page-head">
      <div>
        <div class="page-sub">内容安全接口（msgSecCheck / imgSecCheck）出错时会先放行，这里记录放行过的请求</div>
      </div>
      <div style="display: flex; gap: 10px">
        <el-select v-model="kind" placeholder="全部类型" style="width: 130px" @change="reload">
          <el-option label="全部类型" value="" />
          <el-option label="文字检测" value="text" />
          <el-option label="图片检测" value="image" />
        </el-select>
        <el-button :loading="loading" @click="reload">刷新</el-button>
      </div>
    </div>

    <div class="card">
      <el-table :data="list" v-loading="loading" size="large" empty-text="没有告警，说明内容安全接口一直正常">
        <el-table-column label="时间" width="160">
          <template #default="{ row }">{{ time(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="类型" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="row.kind === 'image' ? 'warning' : 'info'">
              {{ row.kind === 'image' ? '图片检测' : '文字检测' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="场景" width="120">
          <template #default="{ row }">{{ sceneLabel(row.scene) }}</template>
        </el-table-column>
        <el-table-column label="错误码" width="110">
          <template #default="{ row }"><span class="muted">{{ row.code || '—' }}</span></template>
        </el-table-column>
        <el-table-column label="说明" min-width="260">
          <template #default="{ row }">
            <div class="clamp-2">{{ row.message || '接口报错，未返回说明' }}</div>
            <div class="muted" v-if="row.extra">内容片段：{{ row.extra }}</div>
          </template>
        </el-table-column>
        <el-table-column label="提交人" width="150">
          <template #default="{ row }">
            <span class="muted">{{ row.openid ? row.openid.slice(-8) : '—' }}</span>
          </template>
        </el-table-column>
      </el-table>
      <div class="pager">
        <el-pagination
          layout="prev, pager, next, total"
          :total="total"
          :page-size="pageSize"
          :current-page="page"
          @current-change="onPage"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { fetchSecurityAlerts } from '../api.js'

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const kind = ref('')
const loading = ref(false)

const SCENES = {
  post: '发帖文字',
  comment: '评论',
  order: '悬赏描述',
  'post-edit': '编辑帖子',
  profile: '昵称',
  avatar: '头像',
  ad: '广告图',
}

function sceneLabel(v) {
  return SCENES[v] || v || '—'
}

function time(ms) {
  if (!ms) return '—'
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function load() {
  loading.value = true
  try {
    const r = await fetchSecurityAlerts(page.value, kind.value)
    if (!r || r.ok === false) {
      ElMessage.error((r && r.msg) || '加载失败')
      return
    }
    list.value = r.list || []
    total.value = r.total || 0
  } catch (err) {
    ElMessage.error('连不上云开发：' + (err.message || err))
  } finally {
    loading.value = false
  }
}

function reload() {
  page.value = 1
  load()
}

function onPage(p) {
  page.value = p
  load()
}

onMounted(load)
</script>
