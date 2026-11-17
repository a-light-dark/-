<template>
  <router-view v-if="route.meta.public" />
  <el-container v-else class="shell">
    <el-aside width="208px" class="aside">
      <div class="brand">
        <span class="logo">🏫</span>
        <div>
          <div class="brand-name">校园圈</div>
          <div class="brand-sub">管理后台</div>
        </div>
      </div>
      <el-menu :default-active="route.path" router class="menu">
        <el-menu-item index="/dashboard">📊 工作台</el-menu-item>
        <el-menu-item index="/reports">🚩 举报处理</el-menu-item>
        <el-menu-item index="/posts">📝 帖子管理</el-menu-item>
        <el-menu-item index="/users">👥 用户管理</el-menu-item>
        <el-menu-item index="/feedback">💬 建议反馈</el-menu-item>
        <el-menu-item index="/announcements">📢 公告管理</el-menu-item>
        <el-menu-item index="/settings">⚙️ 运营配置</el-menu-item>
        <el-menu-item index="/trash">🗑️ 回收站</el-menu-item>
        <el-menu-item index="/words">🚫 敏感词库</el-menu-item>
        <el-menu-item index="/backup">💾 数据备份</el-menu-item>
      </el-menu>
      <div class="aside-foot">
        <span v-if="isMock" class="mock-flag">演示模式</span>
        <span class="version">v0.7 · PC 后台</span>
      </div>
    </el-aside>
    <el-container>
      <el-header class="header">
        <div class="header-title">{{ route.meta.title || '' }}</div>
        <div class="header-right">
          <span class="admin-name">圈主</span>
          <el-button text @click="onLogout">退出登录</el-button>
        </div>
      </el-header>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { isMock, logout } from './api.js'

const route = useRoute()
const router = useRouter()

async function onLogout() {
  try {
    await ElMessageBox.confirm('确定要退出登录吗？', '退出', { type: 'warning' })
  } catch (err) {
    return
  }
  await logout()
  router.replace('/login')
}
</script>

<style scoped>
.shell {
  height: 100%;
}

.aside {
  background: #10161d;
  color: #c7ccd4;
  display: flex;
  flex-direction: column;
  padding: 18px 12px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 10px 18px;
}

.logo {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: rgba(7, 193, 96, 0.15);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
}

.brand-name {
  color: #fff;
  font-weight: 600;
}

.brand-sub {
  font-size: 12px;
  color: #7b838f;
}

.menu {
  border-right: none;
  background: transparent;
  flex: 1;
}

.menu :deep(.el-menu-item) {
  color: #c7ccd4;
  border-radius: 8px;
  margin-bottom: 4px;
}

.menu :deep(.el-menu-item:hover) {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}

.menu :deep(.el-menu-item.is-active) {
  background: rgba(7, 193, 96, 0.16);
  color: #3ddc84;
}

.aside-foot {
  padding: 10px 10px 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: #6b7280;
}

.mock-flag {
  color: #e6a23c;
}

.header {
  background: #fff;
  border-bottom: 1px solid #eef0f2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;
}

.header-title {
  font-size: 16px;
  font-weight: 600;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.admin-name {
  color: var(--muted);
  font-size: 13px;
}

.main {
  padding: 0;
  overflow-y: auto;
}
</style>
