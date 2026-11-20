<template>
  <div class="page">
    <div class="page-head">
      <div>
        <div class="page-sub">把数据库 20 个集合导出成一个 JSON 存到云存储（超过 8MB 会拒绝，先清一些数据）</div>
      </div>
      <div style="display: flex; gap: 10px">
        <el-button :loading="loading" @click="load">刷新</el-button>
        <el-button type="primary" :loading="creating" @click="onCreate">立即备份</el-button>
      </div>
    </div>

    <div class="card">
      <el-table :data="list" v-loading="loading" size="large" empty-text="还没有备份">
        <el-table-column label="来源" width="100">
          <template #default="{ row }">{{ row.source === 'auto' ? '自动备份' : '手动备份' }}</template>
        </el-table-column>
        <el-table-column label="备份时间" width="200">
          <template #default="{ row }">{{ time(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="大小" width="160">
          <template #default="{ row }">{{ sizeLabel(row.size) }}</template>
        </el-table-column>
        <el-table-column label="说明" min-width="240">
          <template #default="{ row }">
            <span class="muted">包含 posts / comments / orders / users / ads / admin_accounts 等 20 个集合的快照</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="330" align="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" plain @click="onDownload(row)">下载链接</el-button>
            <el-button v-if="canRestore" size="small" type="warning" plain @click="onRestore(row)">恢复</el-button>
            <el-button size="small" type="danger" plain @click="onRemove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="muted" style="margin-top: 10px">
        下载链接是云存储的临时地址，把 JSON 存到电脑上就是一份完整备份。「恢复」会按文档 id 覆盖写回线上数据（幂等，可重复执行），恢复前会先试算每个集合的条数。
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createBackup, downloadBackup, fetchBackups, fetchMe, removeBackup, restoreBackup } from '../api.js'

const list = ref([])
const loading = ref(false)
const creating = ref(false)
const role = ref('')
const canRestore = computed(() => role.value === 'owner' || role.value === 'admin')

function time(ms) {
  if (!ms) return '—'
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function sizeLabel(n) {
  const v = Number(n) || 0
  if (v < 1024) return v + ' B'
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB'
  return (v / 1024 / 1024).toFixed(2) + ' MB'
}

async function load() {
  loading.value = true
  try {
    const r = await fetchBackups()
    if (!r || r.ok === false) {
      ElMessage.error((r && r.msg) || '加载失败')
      return
    }
    list.value = r.list || []
  } catch (err) {
    ElMessage.error('连不上云开发：' + (err.message || err))
  } finally {
    loading.value = false
  }
}

async function onCreate() {
  try {
    await ElMessageBox.confirm('现在把数据库整体备份一份到云存储？数据多时可能要十几秒。', '立即备份', { type: 'info' })
  } catch (err) {
    return
  }
  creating.value = true
  try {
    const r = await createBackup()
    if (r && r.ok) {
      ElMessage.success('备份完成：' + sizeLabel(r.size))
      load()
    } else {
      ElMessage.error((r && r.msg) || '备份失败')
    }
  } finally {
    creating.value = false
  }
}

async function onDownload(row) {
  const r = await downloadBackup(row.id)
  if (r && r.ok && r.url) {
    window.open(r.url, '_blank')
  } else {
    ElMessage.error((r && r.msg) || '拿不到下载链接')
  }
}

async function onRemove(row) {
  try {
    await ElMessageBox.confirm('删除这份备份？云存储里的文件也会一起删掉。', '删除备份', { type: 'warning' })
  } catch (err) {
    return
  }
  const r = await removeBackup(row.id)
  if (r && r.ok) {
    ElMessage.success('已删除')
    load()
  } else {
    ElMessage.error((r && r.msg) || '删除失败')
  }
}

async function onRestore(row) {
  let dry
  try {
    dry = await restoreBackup(row.id, true)
  } catch (err) {
    ElMessage.error('连不上云开发：' + (err.message || err))
    return
  }
  if (!dry || dry.ok === false) {
    ElMessage.error((dry && dry.msg) || '读备份失败')
    return
  }
  const detail = Object.keys(dry.collections || {})
    .filter((k) => dry.collections[k] > 0)
    .map((k) => k + ' ' + dry.collections[k])
    .join('、')
  try {
    await ElMessageBox.confirm(
      `这份备份有 ${dry.total} 条文档：${detail}。恢复会用备份里的内容覆盖同 id 的线上数据，确定继续？`,
      '恢复数据',
      { type: 'warning', confirmButtonText: '确认恢复', cancelButtonText: '先不恢复' }
    )
  } catch (err) {
    return
  }
  try {
    // 分批写回：每批 50 条，直到后端说 done（一次写完会超过云函数超时）
    const merged = {}
    let from = 0
    let guard = 0
    let last = null
    while (guard++ < 100) {
      const r = await restoreBackup(row.id, false, { from, limit: 50 })
      if (!r || r.ok === false) {
        ElMessage.error((r && r.msg) || '恢复失败（第 ' + Math.round(from / 50 + 1) + ' 批）')
        return
      }
      last = r
      Object.keys(r.collections || {}).forEach((k) => {
        merged[k] = (merged[k] || 0) + r.collections[k]
      })
      from = r.next
      if (r.done) break
    }
    const done = Object.keys(merged)
      .map((k) => k + ' ' + merged[k])
      .join('、')
    ElMessage.success('已恢复 ' + from + ' 条：' + done)
    if (last && last.warnings && last.warnings.length) {
      ElMessage.warning('有 ' + last.warnings.length + ' 条没完全恢复：' + last.warnings[0])
    }
    load()
  } catch (err) {
    ElMessage.error('恢复失败：' + (err.message || err))
  }
}

onMounted(async () => {
  load()
  try {
    const me = await fetchMe()
    if (me && me.ok) role.value = me.role || ''
  } catch (err) {
    role.value = ''
  }
})
</script>
