<template>
  <div class="page">
    <div class="page-head">
      <div class="page-sub">账号用「身份」区分能做什么：圈主/开发者/管理员全权，运营管内容，数据分析员只读</div>
      <el-button type="primary" @click="openCreate">新建账号</el-button>
    </div>

    <el-card shadow="never">
      <el-table :data="list" v-loading="loading" style="width: 100%">
        <el-table-column prop="username" label="账号" width="140" />
        <el-table-column prop="nickname" label="昵称" width="160" />
        <el-table-column label="身份" width="220">
          <template #default="{ row }">
            <el-select :model-value="row.role" size="small" style="width: 190px" @change="(v) => onRoleChange(row, v)">
              <el-option v-for="r in ROLES" :key="r.value" :label="r.label" :value="r.value" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-switch :model-value="row.active" @change="(v) => onActiveChange(row, v)" />
            <span class="state-text">{{ row.active ? '启用' : '停用' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="160">
          <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" min-width="220">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="onResetPassword(row)">重置密码</el-button>
            <el-button size="small" text type="danger" :disabled="row.username === me.username" @click="onRemove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialog" title="新建后台账号" width="420px">
      <el-form label-width="88px">
        <el-form-item label="账号">
          <el-input v-model="form.username" maxlength="20" placeholder="3-20 位字母/数字/下划线" />
        </el-form-item>
        <el-form-item label="昵称">
          <el-input v-model="form.nickname" maxlength="20" placeholder="比如：校园运营小王" />
        </el-form-item>
        <el-form-item label="身份">
          <el-select v-model="form.role" style="width: 100%">
            <el-option v-for="r in ROLES" :key="r.value" :label="r.label" :value="r.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="初始密码">
          <el-input v-model="form.password" type="password" show-password maxlength="30" placeholder="至少 8 位，含字母和数字" />
        </el-form-item>
      </el-form>
      <div class="tip">开发者：能看所有数据，但「修改」会先进入审核，由管理员点通过后才生效。</div>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onCreate">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createAccount, fetchAccounts, fetchMe, removeAccount, setAccountActive, setAccountPassword, setAccountRole } from '../api.js'

const ROLES = [
  { value: 'owner', label: '圈主' },
  { value: 'developer', label: '开发者（修改需审核）' },
  { value: 'admin', label: '管理员' },
  { value: 'operator', label: '运营' },
  { value: 'analyst', label: '数据分析员（只读）' },
]

const list = ref([])
const loading = ref(false)
const dialog = ref(false)
const saving = ref(false)
const me = reactive({ username: '' })
const form = reactive({ username: '', nickname: '', role: 'operator', password: '' })

const fmt = (ts) => {
  if (!ts) return '-'
  const d = new Date(Number(ts))
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function load() {
  loading.value = true
  try {
    const res = await fetchAccounts()
    if (res.ok) list.value = res.list || []
    else ElMessage.error(res.msg || '加载失败')
  } finally {
    loading.value = false
  }
}

async function loadMe() {
  const res = await fetchMe()
  if (res && res.ok) me.username = res.username || ''
}

onMounted(async () => {
  await loadMe()
  await load()
})

function openCreate() {
  form.username = ''
  form.nickname = ''
  form.role = 'operator'
  form.password = ''
  dialog.value = true
}

async function onCreate() {
  if (!form.username || form.password.length < 8) {
    ElMessage.warning('账号要 3-20 位，密码至少 8 位且含字母和数字')
    return
  }
  saving.value = true
  try {
    const res = await createAccount({ username: form.username.trim(), nickname: form.nickname.trim(), role: form.role, password: form.password })
    if (!res.ok) {
      ElMessage.error(res.msg || '创建失败')
      return
    }
    ElMessage.success('账号建好了')
    dialog.value = false
    await load()
  } finally {
    saving.value = false
  }
}

async function onRoleChange(row, role) {
  if (role === row.role) return
  const res = await setAccountRole(row.username, role)
  if (!res.ok) {
    ElMessage.error(res.msg || '改角色失败')
    return
  }
  ElMessage.success('身份改了')
  await load()
}

async function onActiveChange(row, active) {
  const res = await setAccountActive(row.username, !!active)
  if (!res.ok) {
    ElMessage.error(res.msg || '操作失败')
    return
  }
  await load()
}

async function onResetPassword(row) {
  let pwd = ''
  try {
    const r = await ElMessageBox.prompt(`给「${row.username}」设置新密码（至少 8 位，含字母和数字）`, '重置密码', {
      inputType: 'password',
      inputPattern: /^(?=.*[a-zA-Z])(?=.*\d).{8,30}$/,
      inputErrorMessage: '密码要 8-30 位，且同时有字母和数字',
    })
    pwd = r.value
  } catch (err) {
    return
  }
  const res = await setAccountPassword(row.username, pwd)
  if (!res.ok) ElMessage.error(res.msg || '重置失败')
  else ElMessage.success('密码已重置')
}

async function onRemove(row) {
  try {
    await ElMessageBox.confirm(`删除账号「${row.username}」？删了这个人就登不进后台了。`, '删除账号', { type: 'warning' })
  } catch (err) {
    return
  }
  const res = await removeAccount(row.username)
  if (!res.ok) ElMessage.error(res.msg || '删除失败')
  else {
    ElMessage.success('已删除')
    await load()
  }
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

.state-text {
  margin-left: 6px;
  font-size: 12px;
  color: var(--muted);
}

.tip {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.7;
}
</style>
