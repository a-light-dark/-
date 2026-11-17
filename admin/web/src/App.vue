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
        <el-menu-item v-for="m in menus" :key="m.path" :index="m.path">
          {{ m.icon }} {{ m.label }}
        </el-menu-item>
      </el-menu>
      <div class="aside-foot">
        <span v-if="isMock" class="mock-flag">演示模式</span>
        <span class="version">v0.8 · PC 后台</span>
      </div>
    </el-aside>
    <el-container>
      <el-header class="header">
        <div class="header-title">{{ route.meta.title || '' }}</div>
        <div class="header-right">
          <el-tag v-if="me.roleLabel" size="small" :type="roleTagType" effect="plain">{{ me.roleLabel }}</el-tag>
          <span class="admin-name">{{ me.username || '未登录' }}</span>
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
import { computed, onMounted, reactive, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { fetchMe, isMock, logout } from './api.js'

const route = useRoute()
const router = useRouter()

const me = reactive({ username: '', role: '', roleLabel: '' })

// 角色 → 能看哪些菜单
const MENUS = [
  { path: '/dashboard', icon: '📊', label: '工作台', roles: ['owner', 'developer', 'admin', 'operator', 'analyst'] },
  { path: '/analytics', icon: '📈', label: '流量看板', roles: ['owner', 'developer', 'admin', 'operator', 'analyst'] },
  { path: '/ads', icon: '🏷️', label: '广告管理', roles: ['owner', 'developer', 'admin', 'operator'] },
  { path: '/reports', icon: '🚩', label: '举报处理', roles: ['owner', 'developer', 'admin', 'operator', 'analyst'] },
  { path: '/posts', icon: '📝', label: '帖子管理', roles: ['owner', 'developer', 'admin', 'operator', 'analyst'] },
  { path: '/users', icon: '👥', label: '用户管理', roles: ['owner', 'developer', 'admin', 'operator', 'analyst'] },
  { path: '/feedback', icon: '💬', label: '建议反馈', roles: ['owner', 'developer', 'admin', 'operator', 'analyst'] },
  { path: '/announcements', icon: '📢', label: '公告管理', roles: ['owner', 'developer', 'admin', 'operator', 'analyst'] },
  { path: '/words', icon: '🚫', label: '敏感词库', roles: ['owner', 'developer', 'admin', 'operator', 'analyst'] },
  { path: '/trash', icon: '🗑️', label: '回收站', roles: ['owner', 'developer', 'admin', 'operator'] },
  { path: '/settings', icon: '⚙️', label: '运营配置', roles: ['owner', 'developer', 'admin'] },
  { path: '/backup', icon: '💾', label: '数据备份', roles: ['owner', 'developer', 'admin'] },
  { path: '/approvals', icon: '✅', label: '修改审核', roles: ['owner', 'developer', 'admin'] },
  { path: '/accounts', icon: '🔐', label: '账号管理', roles: ['owner'] },
]

const menus = computed(() => {
  if (!me.role) return MENUS.filter((m) => m.roles.indexOf('analyst') > -1)
  return MENUS.filter((m) => m.roles.indexOf(me.role) > -1)
})

const roleTagType = computed(() => {
  if (me.role === 'owner') return 'success'
  if (me.role === 'developer') return 'warning'
  if (me.role === 'admin') return 'primary'
  if (me.role === 'operator') return 'info'
  return 'info'
})

async function loadMe() {
  const res = await fetchMe()
  if (res && res.ok && res.admin) {
    me.username = res.username || ''
    me.role = res.role || ''
    me.roleLabel = res.roleLabel || ''
  }
}

onMounted(() => {
  // 演示模式可以用 ?role=analyst 直接切换身份看菜单
  const q = new URLSearchParams(location.search).get('role')
  if (isMock && q && ['owner', 'developer', 'admin', 'operator', 'analyst'].indexOf(q) > -1) localStorage.setItem('mock_role', q)
  loadMe()
})

// 没权限的页面（比如运营打开运营配置）直接送回工作台
watch(
  () => [route.path, me.role],
  () => {
    if (route.meta.public || !me.role) return
    const hit = MENUS.find((m) => m.path === route.path)
    if (hit && hit.roles.indexOf(me.role) === -1) {
      router.replace('/dashboard')
    }
  }
)

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
  overflow-y: auto;
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
