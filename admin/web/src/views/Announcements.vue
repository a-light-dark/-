<template>
  <div class="page">
    <div class="page-head">
      <div>
        <div class="page-sub">公告会显示在首页 banner 下面（最多取前 3 条，按置顶优先）</div>
      </div>
      <div style="display: flex; gap: 10px">
        <el-button :loading="loading" @click="load">刷新</el-button>
        <el-button type="primary" @click="openCreate">发公告</el-button>
      </div>
    </div>

    <div class="card">
      <el-table :data="list" v-loading="loading" size="large" empty-text="还没有公告">
        <el-table-column label="标题" width="220">
          <template #default="{ row }">
            <div style="display: flex; align-items: center; gap: 6px">
              <el-tag v-if="row.pinned" size="small" type="warning">置顶</el-tag>
              <span>{{ row.title }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="内容" min-width="320">
          <template #default="{ row }">
            <div class="clamp-2">{{ row.content }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.active ? 'success' : 'info'" size="small">{{ row.active ? '展示中' : '已下架' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="150">
          <template #default="{ row }">{{ time(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="320" align="right">
          <template #default="{ row }">
            <el-button size="small" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" @click="onTogglePin(row)">{{ row.pinned ? '取消置顶' : '置顶' }}</el-button>
            <el-button size="small" @click="onToggleActive(row)">{{ row.active ? '下架' : '上架' }}</el-button>
            <el-button size="small" type="danger" plain @click="onRemove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialog" :title="form.id ? '编辑公告' : '发公告'" width="560px">
      <el-form label-width="64px">
        <el-form-item label="标题">
          <el-input v-model="form.title" maxlength="50" show-word-limit placeholder="一句话说清是什么事" />
        </el-form-item>
        <el-form-item label="内容">
          <el-input v-model="form.content" type="textarea" :rows="5" maxlength="500" show-word-limit />
        </el-form-item>
        <el-form-item label="置顶">
          <el-switch v-model="form.pinned" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createAnnouncement, fetchAnnouncements, removeAnnouncement, updateAnnouncement } from '../api.js'

const list = ref([])
const loading = ref(false)
const dialog = ref(false)
const saving = ref(false)
const form = reactive({ id: '', title: '', content: '', pinned: false, active: true })

function time(ms) {
  if (!ms) return '—'
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function load() {
  loading.value = true
  try {
    const r = await fetchAnnouncements()
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

function openCreate() {
  Object.assign(form, { id: '', title: '', content: '', pinned: false, active: true })
  dialog.value = true
}

function openEdit(row) {
  Object.assign(form, { id: row.id, title: row.title, content: row.content, pinned: row.pinned, active: row.active })
  dialog.value = true
}

async function onSave() {
  if (!form.title.trim() || !form.content.trim()) {
    ElMessage.warning('标题和内容都要填')
    return
  }
  saving.value = true
  try {
    const payload = {
      id: form.id,
      title: form.title.trim(),
      content: form.content.trim(),
      pinned: form.pinned,
      active: form.active,
    }
    const r = form.id ? await updateAnnouncement(payload) : await createAnnouncement(payload)
    if (r && r.ok) {
      ElMessage.success('已保存')
      dialog.value = false
      load()
    } else {
      ElMessage.error((r && r.msg) || '保存失败')
    }
  } finally {
    saving.value = false
  }
}

async function onTogglePin(row) {
  const r = await updateAnnouncement({
    id: row.id,
    title: row.title,
    content: row.content,
    pinned: !row.pinned,
    active: row.active,
  })
  if (r && r.ok) load()
  else ElMessage.error((r && r.msg) || '操作失败')
}

async function onToggleActive(row) {
  const r = await updateAnnouncement({
    id: row.id,
    title: row.title,
    content: row.content,
    pinned: row.pinned,
    active: !row.active,
  })
  if (r && r.ok) load()
  else ElMessage.error((r && r.msg) || '操作失败')
}

async function onRemove(row) {
  try {
    await ElMessageBox.confirm(`删除公告「${row.title}」？`, '删除公告', { type: 'warning' })
  } catch (err) {
    return
  }
  const r = await removeAnnouncement(row.id)
  if (r && r.ok) {
    ElMessage.success('已删除')
    load()
  } else {
    ElMessage.error((r && r.msg) || '操作失败')
  }
}

onMounted(load)
</script>
