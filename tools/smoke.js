#!/usr/bin/env node
/**
 * 常驻冒烟测试：不打开微信开发者工具，直接用 tcb CLI 调线上云函数，
 * 把「登录 → 后台接口 → 首页数据 → 搜索 → 榜单 → 详情页」这条主链路跑一遍。
 *
 *   node tools/smoke.js            # 全部跑
 *   node tools/smoke.js --env xxx  # 指定环境（默认读 cloudbaserc/全局默认）
 *
 * 任一环节失败 → 退出码 1，方便挂到自动化任务里每天跑一次。
 */
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const args = process.argv.slice(2)
const envFlag = args.indexOf('--env')
const ENV = envFlag > -1 ? args[envFlag + 1] : ''
const PROJECT = path.resolve(__dirname, '..')
const USERNAME = process.env.SMOKE_USER || 'admin'
const PASSWORD = process.env.SMOKE_PASS || 'campus2026'

const which = spawnSync('where.exe', ['tcb'], { encoding: 'utf8' })
const TCB = String(which.stdout || '').split(/\r?\n/).filter(Boolean)[0]
if (!TCB) {
  console.error('找不到 tcb 命令，先装：npm i -g @cloudbase/cli')
  process.exit(1)
}

let seq = 0
function invoke(fn, payload) {
  const file = path.join(os.tmpdir(), 'campus-smoke-' + process.pid + '-' + (++seq) + '.json')
  fs.writeFileSync(file, JSON.stringify(payload || {}), 'utf8')
  const argv = ['/c', TCB, 'fn', 'invoke', fn, '-d', '@' + file, '--json']
  if (ENV) argv.push('-e', ENV)
  const r = spawnSync('cmd.exe', argv, { cwd: PROJECT, encoding: 'utf8' })
  try { fs.unlinkSync(file) } catch (e) {}
  const raw = String(r.stdout || '')
  const start = raw.indexOf('{')
  if (start < 0) return { __error: (String(r.stderr || '') || raw).slice(0, 300) }
  let obj
  try { obj = JSON.parse(raw.slice(start)) } catch (e) { return { __error: 'tcb 输出不是 JSON：' + raw.slice(0, 200) } }
  if (obj.error) return { __error: (obj.error.message || '') + ' ' + (obj.error.code || '') }
  const msg = obj.data && obj.data.RetMsg
  if (typeof msg !== 'string') return { __error: '云函数没有返回内容' }
  try { return JSON.parse(msg) } catch (e) { return { __error: '返回不是 JSON：' + msg.slice(0, 200) } }
}

const results = []
function check(name, fn) {
  try {
    const r = fn()
    if (r && r.__error) {
      results.push({ name, ok: false, detail: r.__error })
      console.log('✗ ' + name + '  ' + r.__error)
      return null
    }
    results.push({ name, ok: true, detail: r && r.detail ? r.detail : '' })
    console.log('✓ ' + name + (r && r.detail ? '  ' + r.detail : ''))
    return r
  } catch (err) {
    results.push({ name, ok: false, detail: (err && err.message) || String(err) })
    console.log('✗ ' + name + '  ' + ((err && err.message) || err))
    return null
  }
}

console.log('冒烟测试：' + PROJECT + (ENV ? '  环境 ' + ENV : ''))
console.log('')

const login = check('后台登录', function () {
  const r = invoke('adminLogin', { action: 'login', username: USERNAME, password: PASSWORD })
  if (!r.ok) throw new Error('登录失败：' + (r.msg || '未知'))
  return { detail: '角色 ' + r.role, token: r.token }
})
const token = login && login.token

if (token) {
  check('后台工作台接口', function () {
    const r = invoke('adminApi', { action: 'dashboard', token: token })
    if (!r.ok) throw new Error(r.msg || '接口返回失败')
    const d = r.data || {}
    return { detail: '帖子 ' + d.posts + ' / 用户 ' + d.users + ' / 待处理举报 ' + d.pendingReports }
  })

  check('安全告警接口', function () {
    const r = invoke('adminApi', { action: 'security.list', token: token, page: 1 })
    if (!r.ok) throw new Error(r.msg || '接口返回失败')
    return { detail: '共 ' + r.total + ' 条' }
  })
}

check('首页数据（siteData）', function () {
  const r = invoke('siteData', {})
  if (!r.ok) throw new Error(r.msg || '接口返回失败')
  return { detail: '公告 ' + ((r.announcements || []).length) + ' 条 / 广告 ' + ((r.ads || []).length) + ' 条' }
})

check('搜索（search）', function () {
  const r = invoke('search', { keyword: '日常', page: 1 })
  if (!r.ok) throw new Error(r.msg || '接口返回失败')
  return { detail: '命中 ' + ((r.posts || []).length) + ' 条，hasMore=' + !!r.hasMore }
})

check('本周榜单（board）', function () {
  const r = invoke('board', { hot: 5, users: 5 })
  if (!r.ok) throw new Error(r.msg || '接口返回失败')
  return {
    detail: '热帖 ' + ((r.hot || []).length) + ' 条 / 活跃同学 ' + ((r.users || []).length) + ' 位' +
      (r.cached ? '（缓存）' : ''),
  }
})

if (token) {
  check('详情页聚合（postDetail）', function () {
    const list = invoke('adminApi', { action: 'posts.list', token: token, page: 1, pageSize: 1 })
    if (!list.ok || !(list.list || []).length) return { detail: '库里还没有帖子，跳过' }
    const id = list.list[0].id
    const r = invoke('postDetail', { postId: id, withView: false })
    if (!r.ok) throw new Error(r.msg || '接口返回失败')
    return { detail: '一条请求拿到 正文 + ' + ((r.comments || []).length) + ' 条评论' }
  })
}

const failed = results.filter(function (r) { return !r.ok })
console.log('')
console.log(failed.length ? ('失败 ' + failed.length + ' 项 / 共 ' + results.length + ' 项') : ('全部通过 ✅（' + results.length + ' 项）'))
process.exit(failed.length ? 1 : 0)
