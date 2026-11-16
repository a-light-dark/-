import { createRouter, createWebHashHistory } from 'vue-router'
import Login from './views/Login.vue'
import Dashboard from './views/Dashboard.vue'
import Reports from './views/Reports.vue'
import Posts from './views/Posts.vue'
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
    { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
  ],
})

router.beforeEach((to) => {
  if (to.meta.public) return true
  if (!getToken()) return { path: '/login' }
  return true
})

export default router
