<template>
  <div class="page">
    <div class="page-head">
      <div>
        <div class="page-sub">
          共 {{ list.length }} 条广告 · 小程序首页 banner 位（详情页底部位已预留，接口是同一个）
        </div>
      </div>
      <div class="head-actions">
        <el-button :loading="loading" @click="load">刷新</el-button>
        <el-button type="primary" @click="openCreate">新建广告</el-button>
      </div>
    </div>

    <div class="card">
      <el-table :data="list" v-loading="loading" size="large" empty-text="还没有广告位，点右上角新建">
        <el-table-column label="图片" width="96">
          <template #default="{ row }">
            <el-image v-if="row.image" :src="row.image" fit="cover" class="thumb" :preview-src-list="[row.image]" preview-teleported />
            <div v-else class="thumb thumb-empty">无图</div>
          </template>
        </el-table-column>
        <el-table-column label="标题" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.title }}</template>
        </el-table-column>
        <el-table-column label="位置" width="130">
          <template #default="{ row }">
            <span class="pos-tag">{{ positionLabel(row.position) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="点击跳转" width="150">
          <template #default="{ row }">{{ linkLabel(row) }}</template>
        </el-table-column>
        <el-table-column label="时间" width="190">
          <template #default="{ row }">{{ windowText(row) }}</template>
        </el-table-column>
        <el-table-column label="曝光 / 点击 / 点击率" width="170">
          <template #default="{ row }">
            {{ row.views }} / {{ row.clicks }} / {{ ctr(row) }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-switch :model-value="row.enabled" @change="(v) => onToggle(row, v)" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" align="right">
          <template #default="{ row }">
            <el-button size="small" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" type="danger" @click="onRemove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialog" :title="form.id ? '编辑广告' : '新建广告'" width="560px" @closed="reset">
      <el-form label-width="88px">
        <el-form-item label="标题" required>
          <el-input v-model="form.title" maxlength="40" show-word-limit placeholder="例如：双十一驾校体验活动" />
        </el-form-item>
        <el-form-item label="图片地址" required>
          <el-input v-model="form.image" placeholder="https://… 或云存储 cloud:// 地址" />
          <div class="muted small" style="margin-top: 4px">
            建议 750×300 左右的横图；小程序里会按 200rpx 高裁切
          </div>
        </el-form-item>
        <el-form-item label="位置">
          <el-radio-group v-model="form.position">
            <el-radio-button value="home_banner">首页 banner</el-radio-button>
            <el-radio-button value="detail_bottom">详情页底部</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="点击跳转">
          <el-radio-group v-model="form.linkType">
            <el-radio-button value="none">不跳转</el-radio-button>
            <el-radio-button value="post">帖子详情</el-radio-button>
            <el-radio-button value="page">小程序页面</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="form.linkType !== 'none'" :label="form.linkType === 'post' ? '帖子 id' : '页面路径'">
          <el-input
            v-model="form.linkValue"
            :placeholder="form.linkType === 'post' ? '例如：7cc5dc476af9…' : '例如：/pages/topic/topic?tag=日常投稿'"
          />
        </el-form-item>
        <el-form-item label="投放时间">
          <el-date-picker
            v-model="range"
            type="datetimerange"
            start-placeholder="开始（可空）"
            end-placeholder="结束（可空）"
            value-format="x"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="权重">
          <el-input-number v-model="form.weight" :min="0" :max="100" />
          <span class="muted small" style="margin-left: 8px">越大越靠前（同位置多条时）</span>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { fetchAds, removeAd, saveAd, toggleAd } from '../api.js'

const list = ref([])
const loading = ref(false)
const saving = ref(false)
const dialog = ref(false)
const range = ref(null)
const form = reactive({
  id: '',
  title: '',
  image: '',
  position: 'home_banner',
  linkType: 'none',
  linkValue: '',
  weight: 0,
  enabled: true,
  startAt: 0,
  endAt: 0,
})

const POSITION = { home_banner: '首页 banner', detail_bottom: '详情页底部' }
const positionLabel = (p) => POSITION[p] || p

function linkLabel(row) {
  if (row.linkType === 'post') return '帖子 ' + String(row.linkValue || '').slice(0, 8)
  if (row.linkType === 'page') return row.linkValue
  return '不跳转'
}

function day(ms) {
  if (!ms) return ''
  const d = new Date(Number(ms))
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${pad(d.getDate())}`
}

function windowText(row) {
  if (!row.startAt && !row.endAt) return '长期投放'
  const a = row.startAt ? day(row.startAt) : '现在'
  const b = row.endAt ? day(row.endAt) : '不限'
  return `${a} → ${b}`
}

function ctr(row) {
  if (!row.views) return '—'
  return ((row.clicks / row.views) * 100).toFixed(1) + '%'
}

async function load() {
  loading.value = true
  try {
    const res = await fetchAds()
    list.value = res.list || []
  } finally {
    loading.value = false
  }
}

function reset() {
  Object.assign(form, {
    id: '',
    title: '',
    image: '',
    position: 'home_banner',
    linkType: 'none',
    linkValue: '',
    weight: 0,
    enabled: true,
    startAt: 0,
    endAt: 0,
  })
  range.value = null
}

function openCreate() {
  reset()
  dialog.value = true
}

function openEdit(row) {
  Object.assign(form, {
    id: row.id,
    title: row.title,
    image: row.image,
    position: row.position,
    linkType: row.linkType,
    linkValue: row.linkValue,
    weight: row.weight,
    enabled: row.enabled,
    startAt: row.startAt || 0,
    endAt: row.endAt || 0,
  })
  range.value = row.startAt || row.endAt ? [row.startAt || 0, row.endAt || 0] : null
  dialog.value = true
}

async function save() {
  if (!form.title.trim()) return ElMessage.warning('标题不能为空')
  if (!form.image.trim()) return ElMessage.warning('图片地址不能为空')
  if (form.linkType === 'post' && !form.linkValue.trim()) return ElMessage.warning('填一下帖子 id')
  if (form.linkType === 'page' && !form.linkValue.trim()) return ElMessage.warning('填一下页面路径')
  const payload = Object.assign({}, form, {
    startAt: range.value && range.value[0] ? Number(range.value[0]) : 0,
    endAt: range.value && range.value[1] ? Number(range.value[1]) : 0,
  })
  if (!payload.id) delete payload.id
  saving.value = true
  try {
    await saveAd(payload)
    ElMessage.success('已保存')
    dialog.value = false
    load()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function onToggle(row, v) {
  try {
    await toggleAd(row.id, v)
    row.enabled = v
    ElMessage.success(v ? '已启用' : '已停用')
  } catch (e) {
    ElMessage.error(e.message || '操作失败')
  }
}

async function onRemove(row) {
  try {
    await ElMessageBox.confirm(`确定删除「${row.title}」这条广告吗？`, '删除广告', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch (e) {
    return
  }
  try {
    await removeAd(row.id)
    ElMessage.success('已删除')
    load()
  } catch (e) {
    ElMessage.error(e.message || '删除失败')
  }
}

onMounted(load)
</script>

<style scoped>
.head-actions {
  display: flex;
  gap: 12px;
}
.thumb {
  width: 72px;
  height: 40px;
  border-radius: 6px;
  display: block;
}
.thumb-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f3f6f4;
  color: #9aa39e;
  font-size: 12px;
}
.pos-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 6px;
  background: #eef8f2;
  color: #0a7f47;
  font-size: 12px;
}
</style>
