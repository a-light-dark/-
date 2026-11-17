<template>
  <div class="page">
    <div class="page-head">
      <div>
        <div class="page-sub">共 {{ total }} 条已删除内容 · 恢复只恢复数据库记录，点赞/评论/图片不会一起回来</div>
      </div>
      <el-button :loading="loading" @click="load(page)">刷新</el-button>
    </div>

    <div class="card">
      <el-table :data="list" v-loading="loading" size="large" empty-text="回收站是空的">
        <el-table-column label="类型" width="90">
          <template #default="{ row }">
            <el-tag :type="row.type === 'post' ? 'warning' : 'info'" size="small">
              {{ row.type === 'post' ? '帖子' : '评论' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="内容" min-width="360">
          <template #default="{ row }">
            <div class="clamp-2">{{ row.content || '（没有内容）' }}</div>
            <div class="muted" v-if="row.meta">{{ row.meta }}</div>
          </template>
        </el-table-column>
        <el-table-column label="删除时间" width="150">
          <template #default="{ row }">{{ time(row.deletedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="240" align="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" plain @click="onRestore(row)">恢复</el-button>
            <el-button size="small" type="danger" plain @click="onPurge(row)">彻底删除</el-button>
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
import { fetchTrash, purgeTrash, restoreTrash } from '../api.js'

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)

function time(ms) {
  if (!ms) return '—'
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function load(p = 1) {
  loading.value = true
  try {
    const r = await fetchTrash(p, pageSize)
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

async function onRestore(row) {
  try {
    await ElMessageBox.confirm(
      `把这条${row.type === 'post' ? '帖子' : '评论'}恢复到原来的位置？点赞、评论、图片不会一起恢复。`,
      '恢复内容',
      { type: 'info' }
    )
  } catch (err) {
    return
  }
  const r = await restoreTrash(row.id, row.type)
  if (r && r.ok) {
    ElMessage.success('已恢复')
    load(page.value)
  } else {
    ElMessage.error((r && r.msg) || '恢复失败')
  }
}

async function onPurge(row) {
  try {
    await ElMessageBox.confirm('彻底删除后就找不回来了，确定？', '彻底删除', {
      type: 'warning',
      confirmButtonClass: 'el-button--danger',
    })
  } catch (err) {
    return
  }
  const r = await purgeTrash(row.id, row.type)
  if (r && r.ok) {
    ElMessage.success('已彻底删除')
    load(page.value)
  } else {
    ElMessage.error((r && r.msg) || '删除失败')
  }
}

onMounted(() => load(1))
</script>
