<template>
  <div class="page">
    <div class="page-head">
      <div>
        <div class="page-sub">这 4 项改完立刻生效（手机端下次打开页面就能看到）</div>
      </div>
      <el-button :loading="loading" @click="loadAll">刷新</el-button>
    </div>

    <div class="card" style="margin-bottom: 16px">
      <div class="section-title">运营配置</div>
      <el-form label-width="120px" style="max-width: 720px">
        <el-form-item label="首页 banner">
          <el-input v-model="settings.bannerText" maxlength="60" placeholder="显示在首页搜索框下面那条紫色横幅（留空用默认文案）" />
        </el-form-item>
        <el-form-item label="首页公告">
          <el-switch v-model="announcementEnabled" />
          <span class="muted" style="margin-left: 12px">{{ announcementEnabled ? '首页会显示公告' : '首页不显示公告' }}</span>
        </el-form-item>
        <el-form-item label="举报处理话术">
          <el-input v-model="settings.reportReplyText" type="textarea" :rows="2" maxlength="100" show-word-limit
            placeholder="处理举报后发给举报人的系统消息（留空用默认）" />
        </el-form-item>
        <el-form-item label="反馈处理话术">
          <el-input v-model="settings.feedbackReplyText" type="textarea" :rows="2" maxlength="100" show-word-limit
            placeholder="处理建议后发给提交人的系统消息（留空用默认）" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="savingAll" @click="saveAll">保存配置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="card" style="margin-bottom: 16px">
      <div class="section-title">修改登录密码</div>
      <el-form label-width="120px" style="max-width: 520px">
        <el-form-item label="当前密码">
          <el-input v-model="pwd.oldPassword" type="password" show-password autocomplete="off" />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="pwd.newPassword" type="password" show-password autocomplete="off" placeholder="至少 8 位，含字母和数字" />
        </el-form-item>
        <el-form-item label="再输一次">
          <el-input v-model="pwd.confirm" type="password" show-password autocomplete="off" />
        </el-form-item>
        <el-form-item>
          <el-button :loading="savingPwd" @click="onChangePassword">修改密码</el-button>
          <span class="muted" style="margin-left: 12px">改完不用重登，下次登录用新密码</span>
        </el-form-item>
      </el-form>
    </div>

    <div class="card">
      <div class="section-title">操作记录（最近 {{ auditTotal }} 条）</div>
      <el-table :data="auditList" v-loading="loading" size="small" empty-text="还没有操作记录">
        <el-table-column label="动作" width="220">
          <template #default="{ row }"><code>{{ row.action }}</code></template>
        </el-table-column>
        <el-table-column label="对象" width="200">
          <template #default="{ row }">
            <span class="muted">{{ row.targetType }}</span>
            <span class="muted"> · {{ String(row.targetId || '').slice(-10) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="说明" min-width="260">
          <template #default="{ row }">
            <span class="clamp-2">{{ row.detail || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="150">
          <template #default="{ row }">{{ time(row.at) }}</template>
        </el-table-column>
      </el-table>

      <div class="pager">
        <el-pagination
          layout="prev, pager, next, total"
          :total="auditTotal"
          :page-size="auditPageSize"
          :current-page="auditPage"
          @current-change="loadAudit"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { changePassword, fetchAudit, fetchSettings, saveSetting } from '../api.js'

const loading = ref(false)
const savingAll = ref(false)
const savingPwd = ref(false)

const settings = reactive({ bannerText: '', reportReplyText: '', feedbackReplyText: '' })
const announcementEnabled = ref(true)

const pwd = reactive({ oldPassword: '', newPassword: '', confirm: '' })

const auditList = ref([])
const auditTotal = ref(0)
const auditPage = ref(1)
const auditPageSize = 20

function time(ms) {
  if (!ms) return '—'
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function loadSettings() {
  const r = await fetchSettings()
  if (!r || r.ok === false) {
    ElMessage.error((r && r.msg) || '配置加载失败')
    return
  }
  const s = r.settings || {}
  settings.bannerText = s.bannerText || ''
  settings.reportReplyText = s.reportReplyText || ''
  settings.feedbackReplyText = s.feedbackReplyText || ''
  announcementEnabled.value = String(s.announcementEnabled || 'true') !== 'false'
}

async function loadAudit(p = 1) {
  const r = await fetchAudit(p, auditPageSize)
  if (!r || r.ok === false) {
    ElMessage.error((r && r.msg) || '操作记录加载失败')
    return
  }
  auditList.value = r.list || []
  auditTotal.value = r.total || 0
  auditPage.value = p
}

async function loadAll() {
  loading.value = true
  try {
    await Promise.all([loadSettings(), loadAudit(1)])
  } catch (err) {
    ElMessage.error('连不上云开发：' + (err.message || err))
  } finally {
    loading.value = false
  }
}

async function saveAll() {
  savingAll.value = true
  try {
    const items = [
      ['bannerText', settings.bannerText.trim()],
      ['announcementEnabled', announcementEnabled.value ? 'true' : 'false'],
      ['reportReplyText', settings.reportReplyText.trim()],
      ['feedbackReplyText', settings.feedbackReplyText.trim()],
    ]
    for (const [key, value] of items) {
      const r = await saveSetting(key, value)
      if (!r || r.ok === false) {
        ElMessage.error((key + ' 保存失败：' + ((r && r.msg) || '')))
        return
      }
    }
    ElMessage.success('已保存，手机端下次打开就生效')
    loadAudit(auditPage.value)
  } catch (err) {
    ElMessage.error('保存失败：' + (err.message || err))
  } finally {
    savingAll.value = false
  }
}

async function onChangePassword() {
  if (!pwd.oldPassword) {
    ElMessage.warning('先填当前密码')
    return
  }
  if (!pwd.newPassword || pwd.newPassword.length < 8 || !/[a-zA-Z]/.test(pwd.newPassword) || !/\d/.test(pwd.newPassword)) {
    ElMessage.warning('新密码至少 8 位，且要有字母和数字')
    return
  }
  if (pwd.newPassword !== pwd.confirm) {
    ElMessage.warning('两次输入的新密码不一样')
    return
  }
  savingPwd.value = true
  try {
    const r = await changePassword(pwd.oldPassword, pwd.newPassword)
    if (r && r.ok) {
      ElMessage.success('密码已更新')
      pwd.oldPassword = ''
      pwd.newPassword = ''
      pwd.confirm = ''
    } else {
      ElMessage.error((r && r.msg) || '修改失败')
    }
  } catch (err) {
    ElMessage.error('修改失败：' + (err.message || err))
  } finally {
    savingPwd.value = false
  }
}

onMounted(loadAll)
</script>

<style scoped>
.section-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 14px;
}
</style>
