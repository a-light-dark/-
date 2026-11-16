<template>
  <div class="page">
    <div class="page-head">
      <div>
        <div class="page-sub">共 {{ total }} 条 · 支持关键词搜索、置顶、删除（进回收站）</div>
      </div>
      <div style="display: flex; gap: 10px">
        <el-input
          v-model="keyword"
          placeholder="搜内容关键词"
          clearable
          style="width: 220px"
          @keyup.enter="search"
          @clear="search"
        />
        <el-button type="primary" @click="search">搜索</el-button>
      </div>
    </div>

    <div class="card">
      <el-table :data="list" v-loading="loading" size="large" empty-text="没有找到帖子">
        <el-table-column label="内容" min-width="340">
          <template #default="{ row }">
            <div class="cell-main">
              <span class="avatar">
                <img v-if="isImage(row.avatar)" :src="row.avatar" alt="" />
                <span v-else>{{ row.avatar || '😀' }}</span>
              </span>
              <div>
                <div class="clamp-2">{{ row.content }}</div>
                <div class="muted" style="margin-top: 4px">
                  {{ row.anonymous ? '匿名同学' : row.nickname || '—' }}
                  <span v-if="row.images && row.images.length">· {{ row.images.length }} 张图</span>
                  <span v-if="row.top"> · 已置顶</span>
                </div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="浏览" width="80" prop="views" />
        <el-table-column label="赞" width="70" prop="likeCount" />
        <el-table-column label="评论" width="80" prop="commentCount" />
        <el-table-column label="发布时间" width="150">
          <template #default="{ row }">{{ time(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="230" align="right">
          <template #default="{ row }">
            <el-button size="small" @click="onTop(row)">{{ row.top ? '取消置顶' : '置顶' }}</el-button>
            <el-button size="small" type="danger" @click="onRemove(row)">删除</el-button>
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
import { fetchPosts, removePost, setPostTop } from '../api.js'

const list = ref([])
const total = ref(0)
const page = ref(1)
const keyword = ref('')
const pageSize = 20
const loading = ref(false)

function isImage(v) {
  return /^cloud:\/\//.test(String(v || '')) || /^https?:\/\//.test(String(v || ''))
}

function time(ms) {
  if (!ms) return '—'
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function load(p = 1) {
  loading.value = true
  try {
    const r = await fetchPosts(p, pageSize, keyword.value.trim())
    if (!r || r.ok === false) {
      ElMessage.error((r && r.msg) || '加载失败')
      return
    }
    list.value = r.list || []
    total.value = r.total || 0
    page.value = r.page || p
  } catch (err) {
    ElMessage.error('连不上云开发：' + (err.message || err))
  } finally {
    loading.value = false
  }
}

function search() {
  load(1)
}

async function onTop(row) {
  const r = await setPostTop(row.id, !row.top)
  if (r && r.ok) {
    row.top = !row.top
    ElMessage.success(row.top ? '已置顶' : '已取消置顶')
  } else {
    ElMessage.error((r && r.msg) || '操作失败')
  }
}

async function onRemove(row) {
  try {
    await ElMessageBox.confirm('删除后帖子会进回收站，可以在那里恢复。', '删除帖子', {
      type: 'warning',
      confirmButtonText: '删除',
    })
  } catch (err) {
    return
  }
  const r = await removePost(row.id)
  if (r && r.ok) {
    ElMessage.success('已删除')
    load(page.value)
  } else {
    ElMessage.error((r && r.msg) || '操作失败')
  }
}

onMounted(() => load(1))
</script>
