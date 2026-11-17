<template>
  <div class="page">
    <div class="page-head">
      <div>
        <div class="page-sub">
          共 {{ total }} / 200 个词 · 发帖/评论/悬赏命中任意一个词就会被拒；「命中」是上线后真实拦下的次数
        </div>
      </div>
      <div class="head-actions">
        <el-input v-model="word" placeholder="要拦的词，例如：代开发票" style="width: 220px" maxlength="20" @keyup.enter="onAdd" />
        <el-button type="primary" :loading="adding" @click="onAdd">加入词库</el-button>
        <el-button @click="batchOpen = true">批量导入</el-button>
        <el-button @click="copyAll">复制全部</el-button>
      </div>
    </div>

    <div class="card">
      <el-table :data="list" v-loading="loading" size="large" empty-text="词库是空的，遇到违规内容可以在这里加词">
        <el-table-column label="词" min-width="200">
          <template #default="{ row }">
            <span class="word">{{ row.word }}</span>
          </template>
        </el-table-column>
        <el-table-column label="命中次数" width="120" sortable :sort-method="(a, b) => a.hits - b.hits">
          <template #default="{ row }">
            <b :class="{ hot: row.hits > 0 }">{{ row.hits || 0 }}</b>
          </template>
        </el-table-column>
        <el-table-column label="最近命中" width="160">
          <template #default="{ row }">{{ time(row.lastHitAt) }}</template>
        </el-table-column>
        <el-table-column label="加入时间" width="160">
          <template #default="{ row }">{{ time(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100" align="right">
          <template #default="{ row }">
            <el-button size="small" type="danger" @click="onRemove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="muted" style="margin-top: 10px">
        提示：微信的 msgSecCheck 已经会拦大部分违规内容；这里是给常用违规词加的「快车道」，命中后会直接提示「内容里有不合适的词」。
      </div>
    </div>

    <el-dialog v-model="batchOpen" title="批量导入敏感词" width="520px">
      <el-input
        v-model="batchText"
        type="textarea"
        :rows="8"
        placeholder="一行一个词，或用逗号分隔&#10;例如：&#10;代开发票&#10;博彩&#10;刷单"
      />
      <div class="muted small" style="margin-top: 8px">
        会自动跳过重复词和超过 20 字的词，单次最多导入 100 个。
      </div>
      <template #footer>
        <el-button @click="batchOpen = false">取消</el-button>
        <el-button type="primary" :loading="batchSaving" @click="onBatchAdd">开始导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { addWord, fetchWords, removeWord } from '../api.js'

const list = ref([])
const total = ref(0)
const word = ref('')
const loading = ref(false)
const adding = ref(false)
const batchOpen = ref(false)
const batchText = ref('')
const batchSaving = ref(false)

function time(ms) {
  if (!ms) return '—'
  const d = new Date(Number(ms))
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function load() {
  loading.value = true
  try {
    const r = await fetchWords()
    if (!r || r.ok === false) {
      ElMessage.error((r && r.msg) || '加载失败')
      return
    }
    list.value = r.list || []
    total.value = r.total != null ? r.total : list.value.length
  } catch (err) {
    ElMessage.error('连不上云开发：' + (err.message || err))
  } finally {
    loading.value = false
  }
}

async function onAdd() {
  const w = word.value.trim()
  if (!w) {
    ElMessage.warning('先输入要拦的词')
    return
  }
  adding.value = true
  try {
    const r = await addWord(w)
    if (r && r.ok) {
      ElMessage.success('已加入')
      word.value = ''
      load()
    } else {
      ElMessage.error((r && r.msg) || '加入失败')
    }
  } finally {
    adding.value = false
  }
}

async function onBatchAdd() {
  const words = batchText.value
    .split(/[\n,，、;；]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 100)
  if (!words.length) {
    ElMessage.warning('先粘贴要导入的词')
    return
  }
  batchSaving.value = true
  let ok = 0
  let skip = 0
  try {
    for (const w of words) {
      try {
        const r = await addWord(w)
        if (r && r.ok) ok++
        else skip++
      } catch (e) {
        skip++
      }
    }
    ElMessage.success(`导入完成：成功 ${ok} 个，跳过 ${skip} 个（重复或超长）`)
    batchText.value = ''
    batchOpen.value = false
    load()
  } finally {
    batchSaving.value = false
  }
}

async function onRemove(w) {
  try {
    await ElMessageBox.confirm(`从词库删掉「${w.word}」？删掉后这个词就不再拦截。`, '删除敏感词', { type: 'warning' })
  } catch (err) {
    return
  }
  const r = await removeWord(w.id)
  if (r && r.ok) {
    ElMessage.success('已删除')
    load()
  } else {
    ElMessage.error((r && r.msg) || '删除失败')
  }
}

async function copyAll() {
  const text = list.value.map((w) => w.word).join('\n')
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制 ' + list.value.length + ' 个词')
  } catch (e) {
    ElMessage.error('浏览器不允许剪贴板，手动选中复制吧')
  }
}

onMounted(load)
</script>

<style scoped>
.head-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}
.word {
  font-weight: 500;
  color: #24322b;
}
.hot {
  color: #e64340;
}
</style>
