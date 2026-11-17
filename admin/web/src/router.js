import { createRouter, createWebHashHistory } from 'vue-router'
import Login from './views/Login.vue'
import Dashboard from './views/Dashboard.vue'
import Reports from './views/Reports.vue'
import Posts from './views/Posts.vue'
import Users from './views/Users.vue'
import Feedback from './views/Feedback.vue'
import Announcements from './views/Announcements.vue'
import Settings from './views/Settings.vue'
import Trash from './views/Trash.vue'
import Words from './views/Words.vue'
import Backup from './views/Backup.vue'
import Accounts from './views/Accounts.vue'
import Approvals from './views/Approvals.vue'
import Analytics from './views/Analytics.vue'
import Ads from './views/Ads.vue'
import { getToken } from './api.js'

const router = createRouter({
  // 用 hash 路由：部署到静态托管不需要配置 rewrite，刷新也不会 404
  history: createWebHashHistory(),
  routes: [
    { path: '/login', component: Login, meta: { public: true, title: '登录' } },
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard', component: Dashboard, meta: { title: '工作台' } },
    { path: '/reports', component: Reports, meta: { title: '举报处理' } },
    { path: '/posts', component: Posts, meta: { title: '帖子管理' } },
    { path: '/users', component: Users, meta: { title: '用户管理' } },
    { path: '/feedback', component: Feedback, meta: { title: '建议反馈' } },
    { path: '/announcements', component: Announcements, meta: { title: '公告管理' } },
    { path: '/settings', component: Settings, meta: { title: '运营配置' } },
    { path: '/trash', component: Trash, meta: { title: '回收站' } },
    { path: '/words', component: Words, meta: { title: '敏感词库' } },
    { path: '/backup', component: Backup, meta: { title: '数据备份' } },
    { path: '/approvals', component: Approvals, meta: { title: '修改审核' } },
    { path: '/accounts', component: Accounts, meta: { title: '账号管理', ownerOnly: true } },
    { path: '/analytics', component: Analytics, meta: { title: '流量看板' } },
    { path: '/ads', component: Ads, meta: { title: '广告管理' } },
    { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
  ],
})

router.beforeEach((to) => {
  if (to.meta.public) return true
  if (!getToken()) return { path: '/login' }
  return true
})

export default router
