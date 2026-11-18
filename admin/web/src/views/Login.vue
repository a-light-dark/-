<template>
  <div class="login-wrap">
    <div class="login-card">
      <div class="logo-row">
        <span class="logo">🏫</span>
        <div>
          <h1>校园圈 · 管理后台</h1>
          <p class="sub">圈子里的帖子、举报、用户，都在这里管</p>
        </div>
      </div>

      <el-form :model="form" label-position="top" @keyup.enter="onSubmit">
        <el-form-item label="账号">
          <el-input v-model="form.username" placeholder="admin" clearable />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" show-password placeholder="请输入密码" />
        </el-form-item>
        <el-button type="primary" class="submit" :loading="loading" @click="onSubmit">登 录</el-button>
      </el-form>

      <p class="hint" v-if="isMock">当前是演示模式：账号 admin，密码 campus2026</p>
      <p class="hint" v-else>第一次登录用默认密码 campus2026，登录后请尽快修改</p>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { isMock, login } from '../api.js'

const router = useRouter()
const form = reactive({ username: 'admin', password: '' })
const loading = ref(false)

async function onSubmit() {
  if (!form.password) {
    ElMessage.warning('请输入密码')
    return
  }
  loading.value = true
  try {
    const r = await login(form.username.trim(), form.password)
    if (r && r.ok) {
      ElMessage.success('欢迎回来')
      // token 存进 sessionStorage 之后刷新一次：外层布局要重新拉一次"我是谁"，
      // 否则菜单和页面会停留在登录前的匿名状态（显示未登录、数据空白）
      await router.replace('/dashboard')
      location.reload()
    } else {
      ElMessage.error((r && r.msg) || '登录失败')
    }
  } catch (err) {
    ElMessage.error('连不上云开发：' + (err && err.message ? err.message : err))
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-wrap {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at 20% 0%, #e8f9ee 0, #f5f7f8 45%, #eef1f4 100%);
}

.login-card {
  width: 380px;
  background: #fff;
  border-radius: 14px;
  padding: 32px 30px 24px;
  box-shadow: 0 18px 50px rgba(16, 24, 40, 0.12);
}

.logo-row {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 24px;
}

.logo {
  width: 46px;
  height: 46px;
  border-radius: 12px;
  background: #e8f9ee;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
}

h1 {
  font-size: 18px;
  margin: 0;
}

.sub {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 12px;
}

.submit {
  width: 100%;
  margin-top: 6px;
}

.hint {
  margin: 16px 0 0;
  font-size: 12px;
  color: var(--muted);
  text-align: center;
}
</style>
