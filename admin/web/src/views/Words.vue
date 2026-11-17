<template>
  <div class="page">
    <div class="page-head">
      <div>
        <div class="page-sub">共 {{ total }} 个词 · 发帖/评论/悬赏命中任意一个词就会被拒（上限 200 个）</div>
      </div>
      <div style="display: flex; gap: 10px">
        <el-input v-model="word" placeholder="要拦的词，例如：代开发票" style="width: 240px" maxlength="20" @keyup.enter="onAdd" />
        <el-button type="primary" :loading="adding" @click="onAdd">加入词库</el-button>
      </div>
    </div>

    <div class="card">
      <div v-loading="loading" style="min-height: 120px">
        <div v-if="!loading && list.length === 0" class="muted" style="padding: 24px 0; text-align: center">
          词库是空的，遇到违规内容可以在这里加词
        </div>
        <div class="words">
          <el-tag
            v-for="w in list"
            :key="w.id"
            closable
            size="large"
            effect="plain"
            style="margin: 0 10px 10px 0"
            @close="onRemove(w)"
          >
            {{ w.word }}
          </el-tag>
        </div>
      </div>
      <div class="muted" style="margin-top: 6px">
        提示：微信的 msgSecCheck 已经会拦大部分违规内容；这里是给常用违规词加的「快车道」，命中后会直接提示「内容里有不合适的词」。
      </div>
    </div>
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

onMounted(load)
</script>
