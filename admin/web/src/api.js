// 数据层：PC 后台和手机端共用同一个 adminApi 云函数
// 网页没有 openid，所以先调 adminLogin 拿 token，之后每次调用都带上
import cloudbase from '@cloudbase/js-sdk'
import { ElMessage } from 'element-plus'

const ENV = import.meta.env.VITE_TCB_ENV || 'cloud1-d6g26wz61eca836b8'
const MOCK = String(import.meta.env.VITE_MOCK || '') === 'true'
const TOKEN_KEY = 'campus_admin_token'

let app = null
let authed = false

export const isMock = MOCK

export function getToken() {
  // 演示模式下不用真的登录也能看页面
  if (MOCK) return localStorage.getItem(TOKEN_KEY) || 'mock-token'
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t)
  else localStorage.removeItem(TOKEN_KEY)
}

async function ensureApp() {
  if (app) return app
  app = cloudbase.init({ env: ENV })
  if (!authed) {
    authed = true
    try {
      const auth = app.auth({ persistence: 'local' })
      if (auth.anonymousAuthProvider) {
        await auth.anonymousAuthProvider().signIn()
      }
    } catch (err) {
      // 没开匿名登录也能继续：部分环境允许免登录调用云函数
      console.warn('[admin] 匿名登录失败，继续尝试直接调用：', err && err.message)
    }
  }
  return app
}

async function invoke(name, data) {
  if (MOCK) {
    const mod = await import('./mock.js')
    return mod.mockCall(name, data)
  }
  const ins = await ensureApp()
  const res = await ins.callFunction({ name, data })
  return res.result
}

export async function login(username, password) {
  const r = await invoke('adminLogin', { action: 'login', username, password })
  if (r && r.ok) setToken(r.token)
  return r
}

export async function logout() {
  const token = getToken()
  setToken('')
  if (MOCK) return { ok: true }
  try {
    await invoke('adminLogin', { action: 'logout', token })
  } catch (err) {
    // 退出失败不影响本地已经清掉的 token
  }
  return { ok: true }
}

export async function callAdmin(action, payload = {}) {
  const r = await invoke('adminApi', Object.assign({ action, token: getToken() }, payload))
  // 开发者提交的修改不会立刻生效，会先进入「审核」，这里统一提示一下
  if (r && r.pending) ElMessage.warning(r.msg || '已提交给管理员审核，通过后才会生效')
  if (r && r.ok === false && /权限/.test(String(r.msg || ''))) {
    ElMessage.error(r.msg)
    setToken('')
  }
  return r
}

// ===== 具体接口（页面直接用这几个）=====
export const fetchDashboard = () => callAdmin('dashboard')

export const fetchReports = (page = 1, pageSize = 20) => callAdmin('reports.list', { page, pageSize })
export const dismissReport = (id) => callAdmin('reports.dismiss', { id })
export const removeReportedPost = (postId) => callAdmin('reports.removePost', { postId })

export const fetchPosts = (page = 1, pageSize = 20, keyword = '') => callAdmin('posts.list', { page, pageSize, keyword })
export const setPostTop = (postId, top) => callAdmin('posts.setTop', { postId, top })
export const removePost = (postId) => callAdmin('posts.remove', { postId })

export const fetchUsers = (page = 1, pageSize = 20, keyword = '') => callAdmin('users.list', { page, pageSize, keyword })
export const banUser = (openid, reason) => callAdmin('users.ban', { openid, reason })
export const unbanUser = (openid) => callAdmin('users.unban', { openid })

export const fetchFeedback = (page = 1, pageSize = 20) => callAdmin('feedback.list', { page, pageSize })
export const resolveFeedback = (id) => callAdmin('feedback.resolve', { id })
export const removeFeedback = (id) => callAdmin('feedback.remove', { id })

export const setUserRole = (openid, role) => callAdmin('users.setRole', { openid, role })

export const fetchAnnouncements = () => callAdmin('announcements.list')
export const createAnnouncement = (payload) => callAdmin('announcements.create', payload)
export const updateAnnouncement = (payload) => callAdmin('announcements.update', payload)
export const removeAnnouncement = (id) => callAdmin('announcements.remove', { id })

export const fetchSettings = () => callAdmin('settings.get')
export const saveSetting = (key, value) => callAdmin('settings.set', { key, value })
export const fetchAudit = (page = 1, pageSize = 20) => callAdmin('audit.list', { page, pageSize })

export const fetchTrash = (page = 1, pageSize = 20) => callAdmin('trash.list', { page, pageSize })
export const restoreTrash = (id, type) => callAdmin('trash.restore', { id, type })
export const purgeTrash = (id, type) => callAdmin('trash.purge', { id, type })

export const fetchWords = () => callAdmin('wordfilters.list')
export const addWord = (word) => callAdmin('wordfilters.add', { word })
export const removeWord = (id) => callAdmin('wordfilters.remove', { id })

export const fetchBackups = () => callAdmin('backup.list')
export const createBackup = () => callAdmin('backup.create')
export const downloadBackup = (id) => callAdmin('backup.download', { id })
export const removeBackup = (id) => callAdmin('backup.remove', { id })

export const fetchIsAdmin = () => callAdmin('isAdmin')

export async function changePassword(oldPassword, newPassword) {
  return invoke('adminLogin', { action: 'changePassword', token: getToken(), oldPassword, newPassword })
}

// ===== 身份与账号（RBAC）=====
export const fetchMe = () => callAdmin('isAdmin')

export const fetchAccounts = () => callAdmin('accounts.list')
export const createAccount = (payload) => callAdmin('accounts.create', payload)
export const setAccountRole = (username, role) => callAdmin('accounts.setRole', { username, role })
export const setAccountPassword = (username, password) => callAdmin('accounts.setPassword', { username, password })
export const setAccountActive = (username, active) => callAdmin('accounts.setActive', { username, active })
export const removeAccount = (username) => callAdmin('accounts.remove', { username })

export const fetchApprovals = (page = 1, pageSize = 20, status = '') => callAdmin('approvals.list', { page, pageSize, status })
export const approveApproval = (id) => callAdmin('approvals.approve', { id })
export const rejectApproval = (id, reason = '') => callAdmin('approvals.reject', { id, reason })

export const tracePost = (postId, page = 1, pageSize = 20) => callAdmin('posts.trace', { postId, page, pageSize })
