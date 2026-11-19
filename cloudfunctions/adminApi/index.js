// 云函数 adminApi —— 管理后台网关（只有管理员能用）
// 设计参考 CampusHub 的「资源型网关」思路：把后台的所有动作收敛到一个函数里，
// 前端（小程序管理台 / 将来的 Web 后台）统一调这一个函数，按 event.action 分发。
// 所有管理动作都会写 audit_logs（谁、什么时候、对什么、做了什么）。

const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const { dayStartCN, seriesDays } = require('./lib/time')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

// 内容安全接口失败时记一条告警，后台「安全告警」页能看到（写失败不影响业务）
function logSecFail(kind, scene, err, extra) {
  try {
    db.collection('security_alerts').add({
      data: {
        kind: kind,
        scene: scene || '',
        code: Number((err && (err.errCode || err.code)) || 0),
        message: String((err && (err.errMsg || err.message)) || ''),
        extra: String(extra || '').slice(0, 200),
        openid: (cloud.getWXContext() || {}).OPENID || '',
        createdAt: db.serverDate(),
      },
    }).then(function () {}, function () {})
  } catch (e) { /* 忽略 */ }
}
const _ = db.command

// 管理员 openid 白名单：想加人就把 openid 加进来（第一个是超管，能任免管理员）
const ADMIN_OPENIDS = [
  'oO3Q4xlLjdjHG-yb77GFRSkzTWsU', // 圈主本人
]

function isAdmin(openid) {
  return ADMIN_OPENIDS.indexOf(openid) > -1
}

function isOwner(openid) {
  return ADMIN_OPENIDS[0] === openid
}

// token → {username, role} 的内存缓存（60 秒），省掉每次管理操作都查一次 admin_sessions
const tokenCache = new Map()

// Web 后台登录态：admin_sessions 里的 token（12 小时，用到一半会自动续期）
const SESSION_TTL = 12 * 3600 * 1000
const SESSION_RENEW_AFTER = 6 * 3600 * 1000

// 工作台数据缓存（30 秒）：一次 dashboard 要算 10 个计数 + join 最近举报，
// 后台来回切页面时没必要每次都全量算一遍。
let dashCache = { at: 0, data: null }
const DASH_CACHE_MS = 30 * 1000

async function resolveToken(token) {
  if (!token) return null
  const key = String(token)
  const hit = tokenCache.get(key)
  if (hit && hit.until > Date.now()) return { username: hit.username, role: hit.role }
  try {
    const res = await db.collection('admin_sessions').where({ token: key }).limit(1).get()
    const s = (res.data || [])[0]
    if (!s) return null
    const exp = Number(s.expiresAt || 0)
    if (exp < Date.now()) return null
    const actor = { username: s.username || 'admin', role: s.role || 'admin' }
    // 滑动续期：剩余不到一半时自动往后延，常来用的人不用反复登录；不常来的自然过期
    let until = exp
    if (exp - Date.now() < SESSION_RENEW_AFTER) {
      until = Date.now() + SESSION_TTL
      try {
        await db.collection('admin_sessions').doc(s._id).update({ data: { expiresAt: until, renewedAt: Date.now() } })
      } catch (err) {
        console.warn('续期 session 失败', err && err.message)
        until = exp
      }
    }
    // 缓存只留 15 秒：省掉大部分重复读，同时「强制下线」能在 15 秒内生效
    tokenCache.set(key, { username: actor.username, role: actor.role, until: Math.min(until, Date.now() + 15000) })
    return actor
  } catch (err) {
    return null
  }
}

function sha256(str) {
  return crypto.createHash('sha256').update(String(str)).digest('hex')
}

// ============ 身份与权限（RBAC） ============
// owner 圈主 / developer 开发者 / admin 管理员 / operator 运营 / analyst 数据分析员
// 规则：
//  - 圈主、开发者、管理员：拥有全部权限
//  - 开发者的「修改类」操作不会直接执行，先生成一条 approvals 待管理员审核
//  - 运营：可删帖/删评论/处理举报、管理公告与敏感词、看审计日志（追溯别人的帖子）
//  - 数据分析员：只读（看数据、看列表，不能改）
let ACTOR = { name: '', role: '' }
const ROLE_LABEL = { owner: '圈主', developer: '开发者', admin: '管理员', operator: '运营', analyst: '数据分析员' }

// 会改动数据的动作（开发者调用时走审核）
const MUTATIONS = [
  'posts.setTop', 'posts.remove', 'comments.remove', 'reports.dismiss', 'reports.removePost',
  'users.ban', 'users.unban', 'users.setRole', 'feedback.resolve', 'feedback.remove',
  'announcements.create', 'announcements.update', 'announcements.remove', 'settings.set',
  'trash.restore', 'trash.purge', 'wordfilters.add', 'wordfilters.remove',
  'ads.save', 'ads.remove', 'ads.toggle',
  'backup.create', 'backup.remove', 'backup.restore',
  'accounts.create', 'accounts.setRole', 'accounts.setPassword', 'accounts.setActive', 'accounts.remove',
  'approvals.approve', 'approvals.reject',
]

const OPERATOR_READ = ['security.list', 'dashboard', 'posts.list', 'comments.list', 'reports.list', 'users.list', 'feedback.list', 'announcements.list', 'settings.get', 'audit.list', 'trash.list', 'wordfilters.list', 'posts.trace', 'analytics.overview', 'ads.list']
const OPERATOR_WRITE = ['posts.remove', 'posts.setTop', 'comments.remove', 'reports.dismiss', 'reports.removePost', 'feedback.resolve', 'announcements.create', 'announcements.update', 'announcements.remove', 'wordfilters.add', 'wordfilters.remove', 'ads.save', 'ads.remove', 'ads.toggle']
const ANALYST_READ = ['security.list', 'dashboard', 'posts.list', 'comments.list', 'reports.list', 'users.list', 'feedback.list', 'announcements.list', 'settings.get', 'trash.list', 'wordfilters.list', 'analytics.overview', 'ads.list']

function allowRole(role, action) {
  if (!role) return false
  // 账号管理只给圈主
  if (action.indexOf('accounts.') === 0) return role === 'owner'
  // 从备份恢复会覆盖线上数据，只给圈主/管理员；开发者要恢复得先发审核单
  if (action === 'backup.restore') return role === 'owner' || role === 'admin'
  // 审核列表开发者可以看（只看自己提交的），通过/驳回只有圈主/管理员能做
  if (action === 'approvals.list') return role === 'owner' || role === 'admin' || role === 'developer'
  if (action.indexOf('approvals.') === 0) return role === 'owner' || role === 'admin'
  if (role === 'owner' || role === 'admin' || role === 'developer') return true
  if (role === 'operator') return OPERATOR_READ.indexOf(action) > -1 || OPERATOR_WRITE.indexOf(action) > -1
  if (role === 'analyst') return ANALYST_READ.indexOf(action) > -1
  return false
}

// 小程序端的管理员：圈主白名单 / 资料里 role === 'admin'
async function roleOfOpenid(openid) {
  if (!openid) return ''
  if (isOwner(openid)) return 'owner'
  if (isAdmin(openid)) return 'admin'
  try {
    const res = await db.collection('users').where({ _openid: openid }).limit(1).get()
    const u = (res.data || [])[0]
    if (u && u.role === 'admin') return 'admin'
  } catch (err) {
    console.warn('查用户角色失败', err && err.message)
  }
  return ''
}

// 转时间戳（毫秒），数据库里可能是 Date 或毫秒
function ts(v) {
  if (!v) return 0
  const d = new Date(v)
  return isNaN(d.getTime()) ? Number(v) || 0 : d.getTime()
}

// 审计日志：所有管理动作都记一笔
async function audit(action, targetType, targetId, detail) {
  try {
    await db.collection('audit_logs').add({
      data: {
        action: String(action || ''),
        targetType: String(targetType || ''),
        targetId: String(targetId || ''),
        detail: String(detail || ''),
        by: ACTOR.name || cloud.getWXContext().OPENID || '',
        role: ACTOR.role || '',
        at: db.serverDate(),
        _openid: cloud.getWXContext().OPENID,
      },
    })
  } catch (err) {
    console.warn('写审计日志失败', err && err.errCode)
  }
}

function esc(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ============ 工作台 ============
async function dashboard(event) {
  // 工作台一次要算 10 个计数（还要 join 举报对应的帖子）。
  // 后台经常来回切页面，30 秒内直接复用结果，少打十几次数据库。
  const force = !!(event && event.force)
  const now = Date.now()
  const today = { createdAt: _.gte(new Date(dayStartCN(now))) }
  const counts = () => Promise.all([
    db.collection('posts').where(today).count(),
    db.collection('comments').where(today).count(),
  ])
  if (!force && dashCache.data && now - dashCache.at < DASH_CACHE_MS) {
    const [posts, comments] = await counts()
    return { ...dashCache.data, data: { ...dashCache.data.data, todayPosts: posts.total, todayComments: comments.total } }
  }
  const [posts, comments, orders, users, reportsCount, feedbackPending, [todayPosts, todayComments]] = await Promise.all([
    db.collection('posts').count(),
    db.collection('comments').count(),
    db.collection('orders').count(),
    db.collection('users').count(),
    db.collection('reports').count(),
    db.collection('feedback').where({ status: '待处理' }).count(),
    counts(),
  ])
  let trashCount = 0
  try {
    const t = await db.collection('trash').count()
    trashCount = t.total
  } catch (err) {
    console.warn('回收站计数失败（集合可能还没建）', err && err.errCode)
  }
  let wordCount = 0
  try {
    const w = await db.collection('wordfilters').count()
    wordCount = w.total
  } catch (err) {
    console.warn('敏感词计数失败（集合可能还没建）', err && err.errCode)
  }

  // 最近 5 条举报 + 帖子信息
  const repRes = await db.collection('reports').orderBy('createdAt', 'desc').limit(5).get()
  const reports = repRes.data || []
  const postIds = reports.map(function (r) { return r.postId }).filter(Boolean)
  let postsArr = []
  if (postIds.length) {
    const pRes = await db.collection('posts').where({ _id: _.in(postIds) }).limit(100).get()
    postsArr = pRes.data || []
  }
  const postMap = {}
  postsArr.forEach(function (p) {
    postMap[p._id] = {
      content: String(p.content || '').slice(0, 60),
      nickname: p.nickname,
      avatar: p.avatar,
    }
  })

  const payload = {
    ok: true,
    data: {
      posts: posts.total,
      comments: comments.total,
      orders: orders.total,
      users: users.total,
      pendingReports: reportsCount.total,
      pendingFeedback: feedbackPending.total,
      todayPosts: todayPosts.total,
      todayComments: todayComments.total,
      trashCount: trashCount,
      wordCount: wordCount,
      recentReports: reports.map(function (r) {
        return { id: r._id, reason: r.reason, createdAt: ts(r.createdAt), post: postMap[r.postId] || null }
      }),
    },
  }
  dashCache = { at: Date.now(), data: payload }
  return payload
}

// ============ 帖子管理 ============
async function postsList(event) {
  const page = Math.max(1, Number(event.page) || 1)
  const pageSize = Math.min(50, Math.max(1, Number(event.pageSize) || 20))
  const keyword = String(event.keyword || '').trim()

  let where = {}
  if (event.onlyTop) where.top = true
  if (keyword) where.content = db.RegExp({ regexp: esc(keyword), options: 'i' })

  const query = db.collection('posts').where(where)
  // 不查总数（count 要全表扫一遍）：多取一条判断还有没有下一页
  const listRes = await query
    .orderBy('createdAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize + 1)
    .get()
  const rows = listRes.data || []
  const hasMore = rows.length > pageSize
  const list = rows.slice(0, pageSize).map(function (p) {
    return {
      id: p._id,
      content: p.content,
      nickname: p.nickname,
      avatar: p.avatar,
      anonymous: p.anonymous === true || p.nickname === '匿名同学',
      authorOpenid: p._openid || '',
      tags: p.tags || [],
      likeCount: p.likeCount || 0,
      commentCount: p.commentCount || 0,
      views: p.views || 0,
      top: p.top === true,
      createdAt: ts(p.createdAt),
    }
  })
  return { ok: true, list: list, page: page, pageSize: pageSize, hasMore: hasMore }
}

async function setPostTop(postId, top) {
  if (!postId) return { ok: false, msg: '缺少帖子 id' }
  try {
    await db.collection('posts').doc(postId).update({
      data: top ? { top: true, topAt: db.serverDate() } : { top: false },
    })
  } catch (err) {
    return { ok: false, msg: '帖子不存在或已被删除' }
  }
  return { ok: true }
}

// 进回收站：删之前把原文档存一份，误删可恢复
async function trashIt(type, docId, data) {
  try {
    await db.collection('trash').add({
      data: {
        type: type, // 'post' | 'comment'
        docId: String(docId || ''),
        data: data || {},
        deletedAt: db.serverDate(),
        deletedBy: cloud.getWXContext().OPENID,
      },
    })
  } catch (err) {
    console.warn('写入回收站失败', err && err.errCode, err && err.errMsg)
  }
}

// 删帖（跟 deletePost / adminReview 同款级联，收藏保留给「已被删除」占位；帖子和评论先进回收站）
async function removePost(postId) {
  if (!postId) return { ok: false, msg: '缺少帖子 id' }
  let doc = null
  let images = []
  try {
    doc = await db.collection('posts').doc(postId).get()
    images = (doc && doc.data && doc.data.images) || []
  } catch (err) {
    console.warn('读取帖子失败（可能已删除）', postId)
  }
  if (doc && doc.data) {
    await trashIt('post', postId, doc.data)
  }
  let comments = { data: [] }
  try {
    comments = await db.collection('comments').where({ postId: postId }).get()
  } catch (err) {
    console.warn('读取帖子评论失败', postId)
  }
  ;(comments.data || []).forEach(function (c) {
    trashIt('comment', c._id, c)
  })
  try {
    await db.collection('posts').doc(postId).remove()
  } catch (err) {
    console.warn('删帖失败（可能已删除）', postId, err && err.errCode)
  }
  await Promise.all([
    db.collection('comments').where({ postId: postId }).remove(),
    db.collection('likes').where({ postId: postId }).remove(),
    db.collection('reports').where({ postId: postId }).remove(),
    db.collection('notices').where({ postId: postId }).remove(),
  ])
  const files = (images || []).map(function (id) { return String(id || '') }).filter(function (id) { return id.indexOf('cloud://') === 0 })
  if (files.length) {
    try {
      await cloud.deleteFile({ fileList: files })
    } catch (err) {
      console.warn('删除帖子图片失败', err && err.errCode, err && err.errMsg)
    }
  }
  return { ok: true }
}

// ============ 评论管理 ============
async function commentsList(event) {
  const page = Math.max(1, Number(event.page) || 1)
  const pageSize = Math.min(50, Math.max(1, Number(event.pageSize) || 20))
  let query = db.collection('comments')
  if (event.postId) query = query.where({ postId: event.postId })
  const countRes = await query.count()
  const listRes = await query.orderBy('createdAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
  return {
    ok: true,
    list: (listRes.data || []).map(function (c) {
      return {
        id: c._id,
        postId: c.postId,
        content: c.content,
        nickname: c.nickname,
        avatar: c.avatar,
        parentId: c.parentId || '',
        replyTo: c.replyTo || '',
        createdAt: ts(c.createdAt),
      }
    }),
    total: countRes.total,
  }
}

async function removeComment(commentId) {
  if (!commentId) return { ok: false, msg: '缺少评论 id' }
  let doc
  try {
    doc = await db.collection('comments').doc(commentId).get()
  } catch (err) {
    return { ok: false, msg: '评论不存在或已删除' }
  }
  const c = doc.data
  let removed = 1
  if (!c.parentId) {
    let sub = { data: [] }
    try {
      sub = await db.collection('comments').where({ parentId: commentId }).get()
    } catch (err) {
      console.warn('读取子回复失败', err && err.errCode)
    }
    ;(sub.data || []).forEach(function (s) {
      trashIt('comment', s._id, s)
      removed += 1
    })
    try {
      await db.collection('comments').where({ parentId: commentId }).remove()
    } catch (err) {
      console.warn('删除子回复失败', err && err.errCode)
    }
  }
  await trashIt('comment', commentId, c)
  await db.collection('comments').doc(commentId).remove()
  try {
    await db.collection('posts').doc(c.postId).update({ data: { commentCount: _.inc(-removed) } })
  } catch (err) {
    console.warn('回补评论数失败', err && err.errCode)
  }
  return { ok: true, removed: removed }
}

// ============ 回收站 ============
async function trashList(event) {
  const page = Math.max(1, Number(event.page) || 1)
  const pageSize = Math.min(50, Math.max(1, Number(event.pageSize) || 20))
  let countRes = { total: 0 }
  let listRes = { data: [] }
  try {
    countRes = await db.collection('trash').count()
    listRes = await db.collection('trash').orderBy('deletedAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
  } catch (err) {
    return { ok: false, msg: '回收站还没建（跑一次 setupCollections 就有了）' }
  }
  return {
    ok: true,
    list: (listRes.data || []).map(function (t) {
      const d = t.data || {}
      return {
        id: t._id,
        type: t.type,
        docId: t.docId,
        content: String(d.content || '').slice(0, 80),
        nickname: d.nickname || '匿名同学',
        deletedAt: ts(t.deletedAt),
      }
    }),
    total: countRes.total,
    hasMore: page * pageSize < countRes.total,
  }
}

async function restoreTrash(id) {
  if (!id) return { ok: false, msg: '缺少回收站记录 id' }
  let doc
  try {
    doc = await db.collection('trash').doc(id).get()
  } catch (err) {
    return { ok: false, msg: '这条回收站记录不存在了' }
  }
  const entry = doc.data
  const data = Object.assign({}, entry.data || {})
  delete data._id
  data._id = entry.docId
  if (entry.type === 'post') {
    try {
      await db.collection('posts').add({ data: data })
    } catch (err) {
      return { ok: false, msg: '恢复失败（帖子 id 冲突或数据异常）' }
    }
  } else if (entry.type === 'comment') {
    try {
      await db.collection('comments').add({ data: data })
    } catch (err) {
      return { ok: false, msg: '恢复失败（评论 id 冲突或数据异常）' }
    }
    try {
      await db.collection('posts').doc(data.postId).update({ data: { commentCount: _.inc(1) } })
    } catch (err) {
      console.warn('回补评论数失败', err && err.errCode)
    }
  } else {
    return { ok: false, msg: '不认识这条回收站记录的类型' }
  }
  await db.collection('trash').doc(id).remove()
  return { ok: true }
}

async function purgeTrash(id) {
  if (!id) return { ok: false, msg: '缺少回收站记录 id' }
  try {
    await db.collection('trash').doc(id).remove()
  } catch (err) {
    return { ok: false, msg: '这条回收站记录不存在了' }
  }
  return { ok: true }
}

// 词库汇总文档（内容入口只读这一份，读 1 次顶 200 条；词改成偶尔重建）
async function syncWordlist() {
  try {
    const r = await db.collection('wordfilters').limit(200).get()
    const words = (r.data || [])
      .map(function (w) { return { id: w._id, word: String(w.word || '') } })
      .filter(function (w) { return w.word })
    try {
      await db.collection('wordlist').doc('main').set({ data: { words: words, updatedAt: db.serverDate() } })
    } catch (err) {
      console.warn('同步词库失败', err && err.errCode)
    }
  } catch (err) {
    console.warn('读词库失败', err && err.errCode)
  }
}

// 配置版本（公告/banner/广告变了就 +1，首页接口据此决定要不要重算）
async function bumpConfigVersion() {
  try {
    await db.collection('meta').doc('versions').update({
      data: { config: db.command.inc(1), ads: db.command.inc(1), updatedAt: db.serverDate() },
    })
  } catch (err) {
    try {
      await db.collection('meta').doc('versions').set({ data: { content: 0, ads: 1, config: 1, updatedAt: db.serverDate() } })
    } catch (e) {}
  }
}

// ============ 敏感词库 ============
async function wordsList() {
  const res = await db.collection('wordfilters').orderBy('createdAt', 'desc').limit(200).get()
  return {
    ok: true,
    list: (res.data || []).map(function (w) {
      return { id: w._id, word: w.word, hits: Number(w.hits || 0), lastHitAt: ts(w.lastHitAt), createdAt: ts(w.createdAt) }
    }),
    total: (res.data || []).length,
  }
}

async function wordsAdd(word) {
  const w = String(word || '').trim()
  if (!w) return { ok: false, msg: '词不能为空' }
  if (w.length > 20) return { ok: false, msg: '词太长啦，20 字以内' }
  try {
    const countRes = await db.collection('wordfilters').count()
    if (countRes.total >= 200) return { ok: false, msg: '词库满了（200 个），先删一些再加' }
    const dup = await db.collection('wordfilters').where({ word: w }).limit(1).get()
    if (dup.data && dup.data[0]) return { ok: false, msg: '这个词已经在词库里了' }
    const added = await db.collection('wordfilters').add({
      data: { word: w, createdAt: db.serverDate() },
    })
    return { ok: true, id: added._id }
  } catch (err) {
    return { ok: false, msg: '添加失败：' + ((err && err.errMsg) || '未知错误') }
  }
}

async function wordsRemove(id) {
  if (!id) return { ok: false, msg: '缺少词 id' }
  try {
    await db.collection('wordfilters').doc(id).remove()
  } catch (err) {
    return { ok: false, msg: '这个词不存在了' }
  }
  return { ok: true }
}

// ============ 数据备份 ============
// 把核心集合导成 JSON 传到云存储 backups/ 下，管理台可下载链接
const BACKUP_COLLECTIONS = [
  'posts', 'comments', 'orders', 'users', 'likes', 'favorites',
  'reports', 'notices', 'feedback', 'follows', 'reviews',
  'announcements', 'bans', 'settings', 'audit_logs', 'trash', 'wordfilters',
  'ads', 'admin_accounts', 'approvals',
]

async function fetchAll(name) {
  const out = []
  for (let page = 0; page < 20; page++) {
    const res = await db.collection(name).skip(page * 1000).limit(1000).get()
    out.push.apply(out, res.data || [])
    if (!(res.data || []).length || (res.data || []).length < 1000) break
  }
  return out
}

async function securityList(event) {
  const page = Math.max(1, Number(event && event.page) || 1)
  const pageSize = Math.min(50, Math.max(10, Number(event && event.pageSize) || 20))
  const kind = String((event && event.kind) || '').trim()
  let base = db.collection('security_alerts')
  if (kind) base = db.collection('security_alerts').where({ kind: kind })
  let countRes
  let listRes
  try {
    countRes = await base.count()
    listRes = await base.orderBy('createdAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
  } catch (err) {
    return { ok: false, msg: '告警表还没建（跑一次 setupCollections 就行）' }
  }
  return {
    ok: true,
    list: (listRes.data || []).map(function (a) {
      return {
        id: a._id,
        kind: a.kind || 'text',
        scene: a.scene || '',
        code: a.code || 0,
        message: a.message || '',
        extra: a.extra || '',
        openid: a.openid || '',
        createdAt: ts(a.createdAt),
      }
    }),
    total: countRes.total || 0,
  }
}

async function backupCreate() {
  const out = {}
  for (let i = 0; i < BACKUP_COLLECTIONS.length; i++) {
    const name = BACKUP_COLLECTIONS[i]
    try {
      out[name] = await fetchAll(name)
    } catch (err) {
      console.warn('备份读取失败（跳过）', name, err && err.errCode)
      out[name] = []
    }
  }
  out.exportedAt = new Date().toISOString()
  const json = JSON.stringify(out)
  if (json.length > 8 * 1024 * 1024) {
    return { ok: false, msg: '数据太大（超过 8MB），先清理一些再备份' }
  }
  const tsStr = new Date().toISOString().replace(/[:.]/g, '-')
  const cloudPath = 'backups/backup-' + tsStr + '.json'
  const up = await cloud.uploadFile({ cloudPath: cloudPath, fileContent: Buffer.from(json, 'utf8') })
  const added = await db.collection('backups').add({
    data: { fileID: up.fileID, size: json.length, createdAt: db.serverDate() },
  })
  return { ok: true, id: added._id, size: json.length }
}

async function backupList() {
  let countRes = { total: 0 }
  let listRes = { data: [] }
  try {
    countRes = await db.collection('backups').count()
    listRes = await db.collection('backups').orderBy('createdAt', 'desc').limit(20).get()
  } catch (err) {
    return { ok: false, msg: '备份记录集合还没建（跑一次 setupCollections）' }
  }
  return {
    ok: true,
    list: (listRes.data || []).map(function (b) {
      return { id: b._id, size: b.size || 0, createdAt: ts(b.createdAt) }
    }),
    total: countRes.total,
  }
}

async function backupDownload(id) {
  if (!id) return { ok: false, msg: '缺少备份记录 id' }
  let doc
  try {
    doc = await db.collection('backups').doc(id).get()
  } catch (err) {
    return { ok: false, msg: '这条备份记录不存在了' }
  }
  try {
    const res = await cloud.getTempFileURL({ fileList: [doc.data.fileID] })
    const f = (res.fileList || [])[0] || {}
    if (f.status === 0) return { ok: true, url: f.tempFileURL }
    return { ok: false, msg: '链接生成失败（' + (f.errMsg || '未知') + '）' }
  } catch (err) {
    return { ok: false, msg: '链接生成失败：' + ((err && err.errMsg) || '未知错误') }
  }
}

async function backupRemove(id) {
  if (!id) return { ok: false, msg: '缺少备份记录 id' }
  let doc
  try {
    doc = await db.collection('backups').doc(id).get()
  } catch (err) {
    return { ok: false, msg: '这条备份记录不存在了' }
  }
  try {
    await cloud.deleteFile({ fileList: [doc.data.fileID] })
  } catch (err) {
    console.warn('删除备份文件失败', err && err.errCode)
  }
  await db.collection('backups').doc(id).remove()
  return { ok: true }
}

// 从备份文件恢复：dryRun 只统计条数，真正恢复时按 _id 覆盖写回（幂等，重复跑结果一样）
async function backupRestore(event) {
  const id = event && event.id
  if (!id) return { ok: false, msg: '缺少备份记录 id' }
  let doc
  try {
    doc = await db.collection('backups').doc(id).get()
  } catch (err) {
    return { ok: false, msg: '这条备份记录不存在了' }
  }
  const fileID = doc.data && doc.data.fileID
  if (!fileID) return { ok: false, msg: '这条备份没有文件记录' }
  let json
  try {
    const f = await cloud.downloadFile({ fileID: fileID })
    json = JSON.parse(f.fileContent.toString('utf8'))
  } catch (err) {
    return { ok: false, msg: '读备份文件失败：' + ((err && (err.errMsg || err.message)) || '未知错误') }
  }
  const names = Object.keys(json || {}).filter(function (k) { return BACKUP_COLLECTIONS.indexOf(k) > -1 })
  if (!names.length) return { ok: false, msg: '备份里没有可恢复的集合' }
  const counts = {}
  let total = 0
  names.forEach(function (n) {
    const arr = Array.isArray(json[n]) ? json[n] : []
    counts[n] = arr.length
    total += arr.length
  })
  if (event.dryRun !== false) return { ok: true, dryRun: true, collections: counts, total: total }
  if (total > 5000) return { ok: false, msg: '这份备份有 ' + total + ' 条文档，单次最多恢复 5000 条' }

  const warnings = []

  // 单个文档写回：先整条覆盖，失败退成合并更新（保住已有的 _openid 归属）
  async function putOne(name, raw) {
    const docId = raw && raw._id
    if (!docId) return false
    const data = Object.assign({}, raw)
    delete data._id
    try {
      await db.collection(name).doc(docId).set({ data: data })
      return true
    } catch (err) {
      try {
        const patch = Object.assign({}, data)
        delete patch._openid
        await db.collection(name).doc(docId).update({ data: patch })
        if (warnings.length < 5) warnings.push(name + '/' + docId + '：用合并方式恢复')
        return true
      } catch (err2) {
        try {
          const plain = Object.assign({}, data)
          delete plain._openid
          await db.collection(name).doc(docId).set({ data: plain })
          if (warnings.length < 5) warnings.push(name + '/' + docId + '：归属字段没恢复')
          return true
        } catch (err3) {
          if (warnings.length < 5) warnings.push(name + '/' + docId + '：' + ((err3 && (err3.errMsg || err3.message)) || '写入失败'))
          return false
        }
      }
    }
  }

  // 把备份里所有文档摊平成一条队列，按 from/limit 分批写：
  // 云函数一次调用只能跑几秒，几百条一次写完必然超时，所以前端循环调。
  const plan = []
  names.forEach(function (name) {
    const arr = Array.isArray(json[name]) ? json[name] : []
    arr.forEach(function (raw) {
      if (raw && raw._id) plan.push({ name: name, raw: raw })
    })
  })

  const from = Math.max(0, Number(event.from) || 0)
  const limit = Math.max(1, Math.min(200, Number(event.limit) || 50))
  const slice = plan.slice(from, from + limit)
  const restored = {}
  const CONCURRENCY = Math.max(1, Math.min(20, Number(event.concurrency) || 10))
  let j = 0
  while (j < slice.length) {
    const batch = slice.slice(j, j + CONCURRENCY)
    j += CONCURRENCY
    const flags = await Promise.all(batch.map(function (item) { return putOne(item.name, item.raw) }))
    for (let k = 0; k < flags.length; k++) {
      if (!flags[k]) continue
      const name = batch[k].name
      restored[name] = (restored[name] || 0) + 1
    }
  }

  const next = from + slice.length
  const done = next >= plan.length

  // 全部恢复完再让客户端重新拉数据（版本号变了才会刷新缓存）
  if (done) {
    try {
      await bumpConfigVersion()
    } catch (err) {}
    try {
      const v = await db.collection('meta').doc('versions').get()
      const content = Number((v.data && v.data.content) || 0)
      await db.collection('meta').doc('versions').update({ data: { content: content + 1 } })
    } catch (err) {}
  }

  return {
    ok: true,
    dryRun: false,
    from: from,
    next: next,
    limit: limit,
    done: done,
    written: slice.length,
    progress: plan.length ? Math.round((next / plan.length) * 100) : 100,
    collections: restored,
    total: plan.length,
    warnings: warnings,
  }
}

// ============ 举报处理 ============
async function reportsList(event) {
  const page = Math.max(1, Number(event && event.page) || 1)
  const pageSize = Math.min(50, Math.max(5, Number(event && event.pageSize) || 20))
  // 不查总数：多取一条就知道还有没有下一页（count 会全表扫）
  const res = await db
    .collection('reports')
    .orderBy('createdAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize + 1)
    .get()
  const rows = res.data || []
  const hasMore = rows.length > pageSize
  const reports = rows.slice(0, pageSize)
  const postIds = reports.map(function (r) { return r.postId }).filter(Boolean)
  let posts = []
  if (postIds.length) {
    const pRes = await db.collection('posts').where({ _id: _.in(postIds) }).limit(100).get()
    posts = pRes.data || []
  }
  const postMap = {}
  posts.forEach(function (p) {
    postMap[p._id] = {
      id: p._id,
      content: p.content,
      nickname: p.nickname,
      avatar: p.avatar,
      images: p.images || [],
      createdAt: ts(p.createdAt),
    }
  })
  return {
    ok: true,
    list: reports.map(function (r) {
      return { id: r._id, postId: r.postId, reason: r.reason, createdAt: ts(r.createdAt), post: postMap[r.postId] || null }
    }),
    page: page,
    pageSize: pageSize,
    hasMore: hasMore,
  }
}

async function dismissReport(id) {
  if (!id) return { ok: false, msg: '缺少举报 id' }
  let reporter = ''
  let postId = ''
  try {
    const r = await db.collection('reports').doc(id).get()
    reporter = r.data && r.data._openid
    postId = (r.data && r.data.postId) || ''
  } catch (err) {
    // 举报不存在也继续删
  }
  await db.collection('reports').doc(id).remove()
  if (reporter && reporter !== cloud.getWXContext().OPENID) {
    await sendSystemNotice(reporter, '你举报的内容我们看过了，感谢反馈～', postId, 'reportReplyText')
  }
  return { ok: true }
}

// 给用户发一条「系统」类通知（圈主处理结果），失败只 warn
async function sendSystemNotice(toOpenid, text, postId, settingKey) {
  try {
    const s = await db.collection('settings').where({ key: settingKey }).limit(1).get()
    const custom = s.data && s.data[0] && String(s.data[0].value || '').trim()
    const finalText = custom || text
    await db.collection('notices').add({
      data: {
        toOpenid: toOpenid,
        type: 'system',
        text: finalText,
        postId: postId || '',
        orderId: '',
        fromNickname: '校园圈圈主',
        fromAvatar: '🛎',
        read: false,
        createdAt: db.serverDate(),
      },
    })
  } catch (err) {
    console.warn('sendSystemNotice 失败（不影响主流程）', err && err.message)
  }
}

// ============ 用户管理 ============
async function usersList(event) {
  const page = Math.max(1, Number(event.page) || 1)
  const pageSize = Math.min(50, Math.max(1, Number(event.pageSize) || 20))
  const keyword = String(event.keyword || '').trim()
  let query = db.collection('users')
  if (keyword) query = query.where({ nickname: db.RegExp({ regexp: esc(keyword), options: 'i' }) })
  const countRes = await query.count()
  const listRes = await query.orderBy('createdAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
  const rows = listRes.data || []
  // 头像存的是 cloud:// 文件 ID，网页直接显示会变成一长串路径，换成临时链接
  const files = rows.map(function (u) { return u.avatar }).filter(function (a) { return a && String(a).indexOf('cloud://') === 0 })
  const urlMap = {}
  if (files.length) {
    try {
      const r = await cloud.getTempFileURL({ fileList: files })
      ;(r.fileList || []).forEach(function (f) {
        if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL
      })
    } catch (err) {
      console.warn('用户头像临时链接失败', err && err.errCode)
    }
  }
  return {
    ok: true,
    list: rows.map(function (u) {
      return {
        openid: u._openid || '',
        nickname: u.nickname,
        avatar: u.avatar,
        avatarUrl: urlMap[u.avatar] || '',
        banned: u.banned === true,
        banReason: u.banReason || '',
        role: u.role || '',
        createdAt: ts(u.createdAt),
      }
    }),
    total: countRes.total,
  }
}

async function banUser(openid, reason) {
  if (!openid) return { ok: false, msg: '缺少用户 openid' }
  if (ADMIN_OPENIDS.indexOf(openid) > -1) return { ok: false, msg: '不能封管理员自己人' }
  let u = null
  try {
    const res = await db.collection('users').where({ _openid: openid }).limit(1).get()
    u = (res.data && res.data[0]) || null
  } catch (err) { /* 忽略 */ }
  await db.collection('users').where({ _openid: openid }).update({
    data: { banned: true, banReason: String(reason || '违规行为'), bannedAt: db.serverDate() },
  })
  await db.collection('bans').add({
    data: {
      openid: openid,
      nickname: u ? u.nickname : '',
      avatar: u ? u.avatar : '',
      reason: String(reason || '违规行为'),
      by: cloud.getWXContext().OPENID,
      createdAt: db.serverDate(),
    },
  })
  return { ok: true }
}

async function unbanUser(openid) {
  if (!openid) return { ok: false, msg: '缺少用户 openid' }
  await db.collection('users').where({ _openid: openid }).update({ data: { banned: false } })
  return { ok: true }
}

async function setUserRole(openid, role) {
  if (role !== 'admin' && role !== '') return { ok: false, msg: '角色只能是 admin 或空' }
  if (!openid) return { ok: false, msg: '缺少用户 openid' }
  await db.collection('users').where({ _openid: openid }).update({ data: { role: role } })
  return { ok: true }
}

// ============ 反馈 ============
async function feedbackList(event) {
  const page = Math.max(1, Number(event && event.page) || 1)
  const pageSize = Math.min(50, Math.max(5, Number(event && event.pageSize) || 20))
  // 不查总数：多取一条判断有没有下一页
  const res = await db
    .collection('feedback')
    .orderBy('createdAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize + 1)
    .get()
  const rows = res.data || []
  const hasMore = rows.length > pageSize
  return {
    ok: true,
    list: rows.slice(0, pageSize).map(function (f) {
      return {
        id: f._id,
        content: f.content,
        contact: f.contact || '',
        nickname: f.nickname || '',
        avatar: f.avatar || '',
        status: f.status || '待处理',
        ts: ts(f.createdAt),
      }
    }),
    page: page,
    pageSize: pageSize,
    hasMore: hasMore,
  }
}

async function feedbackResolve(id) {
  if (!id) return { ok: false, msg: '缺少反馈 id' }
  let submitter = ''
  try {
    const f = await db.collection('feedback').doc(id).get()
    submitter = f.data && f.data._openid
  } catch (err) {
    // 反馈不存在也继续
  }
  const res = await db.collection('feedback').doc(id).update({ data: { status: '已处理', resolvedAt: db.serverDate() } })
  if (!res.stats || res.stats.updated === 0) return { ok: false, msg: '这条反馈不存在或已经处理过了' }
  if (submitter && submitter !== cloud.getWXContext().OPENID) {
    await sendSystemNotice(submitter, '你提的建议我们收到啦，已经处理，谢谢！', '', 'feedbackReplyText')
  }
  return { ok: true }
}

async function feedbackRemove(id) {
  if (!id) return { ok: false, msg: '缺少反馈 id' }
  const res = await db.collection('feedback').doc(id).remove()
  if (!res.stats || res.stats.removed === 0) return { ok: false, msg: '这条反馈不存在' }
  return { ok: true }
}

// ============ 公告 ============
async function announcementsList() {
  const res = await db.collection('announcements').orderBy('pinned', 'desc').orderBy('createdAt', 'desc').limit(50).get()
  return {
    ok: true,
    list: (res.data || []).map(function (a) {
      return {
        id: a._id,
        title: a.title,
        content: a.content,
        active: a.active !== false,
        pinned: a.pinned === true,
        createdAt: ts(a.createdAt),
        createdBy: a.createdBy || '',
      }
    }),
  }
}

async function announcementSave(event, isUpdate) {
  const title = String(event.title || '').trim()
  const content = String(event.content || '').trim()
  if (!title || !content) return { ok: false, msg: '标题和内容都要填' }
  if (title.length > 50) return { ok: false, msg: '标题最多 50 个字' }
  if (content.length > 500) return { ok: false, msg: '内容最多 500 个字' }
  const data = {
    title: title,
    content: content,
    pinned: event.pinned === true,
  }
  if (isUpdate) {
    if (!event.id) return { ok: false, msg: '缺少公告 id' }
    if (typeof event.active === 'boolean') data.active = event.active
    try {
      await db.collection('announcements').doc(event.id).update({ data: data })
    } catch (err) {
      return { ok: false, msg: '公告不存在' }
    }
    return { ok: true }
  }
  data.active = true
  data.createdBy = cloud.getWXContext().OPENID
  data.createdAt = db.serverDate()
  const added = await db.collection('announcements').add({ data: data })
  return { ok: true, id: added._id }
}

async function announcementRemove(id) {
  if (!id) return { ok: false, msg: '缺少公告 id' }
  const res = await db.collection('announcements').doc(id).remove()
  if (!res.stats || res.stats.removed === 0) return { ok: false, msg: '公告不存在' }
  return { ok: true }
}

// ============ 参数配置 ============
// 白名单 key：只允许这几个，防止乱写
const SETTING_KEYS = ['bannerText', 'announcementEnabled', 'reportReplyText', 'feedbackReplyText']

async function settingsGet() {
  const res = await db.collection('settings').limit(100).get()
  const map = {}
  ;(res.data || []).forEach(function (s) {
    map[s.key] = s.value
  })
  return { ok: true, settings: map }
}

async function settingsSet(key, value) {
  if (!key || SETTING_KEYS.indexOf(key) < 0) return { ok: false, msg: '不允许改这个参数' }
  const data = { key: key, value: String(value == null ? '' : value), updatedAt: db.serverDate() }
  const res = await db.collection('settings').where({ key: key }).update({ data: data })
  if (res.stats && res.stats.updated === 0) {
    await db.collection('settings').add({ data: data })
  }
  return { ok: true }
}

// ============ 审计日志 ============
async function auditList(event) {
  const page = Math.max(1, Number(event.page) || 1)
  const pageSize = Math.min(50, Math.max(1, Number(event.pageSize) || 20))
  const targetId = String(event.targetId || '').trim()
  let query = db.collection('audit_logs')
  if (targetId) query = query.where({ targetId: targetId })
  const countRes = await query.count()
  const listRes = await query.orderBy('at', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
  return {
    ok: true,
    list: (listRes.data || []).map(function (a) {
      return { id: a._id, action: a.action, targetType: a.targetType, targetId: a.targetId, detail: a.detail, by: a.by || '', role: a.role || '', at: ts(a.at) }
    }),
    total: countRes.total,
  }
}


// ============ 后台账号（多身份） ============
async function accountsList() {
  let res
  try {
    res = await db.collection('admin_accounts').orderBy('createdAt', 'asc').limit(100).get()
  } catch (err) {
    return { ok: false, msg: '账号集合还没建（跑一次 setupCollections）' }
  }
  return {
    ok: true,
    list: (res.data || []).map(function (a) {
      return {
        username: a.username,
        role: a.role || 'admin',
        roleLabel: ROLE_LABEL[a.role] || a.role || '管理员',
        nickname: a.nickname || '',
        active: a.active !== false,
        createdAt: ts(a.createdAt),
      }
    }),
  }
}

function weakPassword(p) {
  if (String(p).length < 8) return '密码至少 8 位'
  if (!/[a-zA-Z]/.test(p) || !/\d/.test(p)) return '密码要同时有字母和数字'
  return ''
}

async function accountCreate(event) {
  const username = String(event.username || '').trim()
  const role = String(event.role || 'operator')
  const password = String(event.password || '')
  const nickname = String(event.nickname || '').trim()
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return { ok: false, msg: '账号要 3-20 位字母/数字/下划线' }
  if (!ROLE_LABEL[role]) return { ok: false, msg: '角色不对' }
  const weak = weakPassword(password)
  if (weak) return { ok: false, msg: '初始' + weak }
  const total = await db.collection('admin_accounts').count()
  if ((total.total || 0) >= 20) return { ok: false, msg: '后台账号最多 20 个，先删掉不用的' }
  const dup = await db.collection('admin_accounts').where({ username: username }).limit(1).get()
  if ((dup.data || []).length) return { ok: false, msg: '这个账号已经有了' }
  await db.collection('admin_accounts').add({
    data: { username: username, role: role, nickname: nickname || username, passwordHash: sha256(password), active: true, createdAt: db.serverDate() },
  })
  return { ok: true, username: username, role: role }
}

async function ownerCount() {
  try {
    const res = await db.collection('admin_accounts').where({ role: 'owner' }).count()
    return res.total || 0
  } catch (err) {
    return 1
  }
}

async function accountSetRole(username, role) {
  const u = String(username || '')
  const r = String(role || '')
  if (!u) return { ok: false, msg: '缺少账号' }
  if (r && !ROLE_LABEL[r]) return { ok: false, msg: '角色不对' }
  if (!r && (await ownerCount()) <= 1) return { ok: false, msg: '至少要保留一个圈主' }
  const res = await db.collection('admin_accounts').where({ username: u }).update({ data: { role: r, updatedAt: db.serverDate() } })
  if (!res.stats.updated) return { ok: false, msg: '账号不存在' }
  // 让这个账号已登录的 token 也立刻换角色
  try {
    await db.collection('admin_sessions').where({ username: u }).update({ data: { role: r } })
  } catch (err) {
    console.warn('同步 session 角色失败', err && err.message)
  }
  return { ok: true }
}

async function accountSetPassword(username, password) {
  const u = String(username || '')
  const p = String(password || '')
  const weak = weakPassword(p)
  if (weak) return { ok: false, msg: '新' + weak }
  const res = await db.collection('admin_accounts').where({ username: u }).update({ data: { passwordHash: sha256(p), updatedAt: db.serverDate() } })
  if (!res.stats.updated) return { ok: false, msg: '账号不存在' }
  return { ok: true }
}

async function accountSetActive(username, active, actorName) {
  const u = String(username || '')
  if (u === actorName && active === false) return { ok: false, msg: '不能停用自己' }
  if (active === false) {
    const acc = await db.collection('admin_accounts').where({ username: u }).limit(1).get()
    const a = (acc.data || [])[0]
    if (a && a.role === 'owner' && (await ownerCount()) <= 1) return { ok: false, msg: '至少要保留一个圈主' }
  }
  const res = await db.collection('admin_accounts').where({ username: u }).update({ data: { active: active !== false, updatedAt: db.serverDate() } })
  if (!res.stats.updated) return { ok: false, msg: '账号不存在' }
  return { ok: true }
}

// ============ 在线设备（后台登录会话） ============
async function sessionsList() {
  const now = Date.now()
  let res
  try {
    res = await db.collection('admin_sessions')
      .where({ expiresAt: _.gt(now) })
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get()
  } catch (err) {
    console.warn('读会话失败', err && err.message)
    return { ok: true, list: [] }
  }
  return {
    ok: true,
    list: (res.data || []).map(function (s) {
      return {
        id: s._id,
        username: s.username || '',
        role: s.role || '',
        createdAt: s.createdAt && s.createdAt.$date ? s.createdAt.$date : (Number(s.createdAt) || 0),
        expiresAt: Number(s.expiresAt) || 0,
      }
    }),
  }
}

// 强制下线：删掉那条 session，对方下一次请求就会被拒（前端 token 失效后跳登录页）
async function sessionRevoke(id, actor) {
  const sid = String(id || '')
  if (!sid) return { ok: false, msg: '缺少会话 id' }
  let doc
  try {
    doc = await db.collection('admin_sessions').doc(sid).get()
  } catch (err) {
    return { ok: false, msg: '这条会话已经失效了' }
  }
  const s = doc.data || {}
  // 管理员只能踢开发者/运营/分析员，圈主的会话只有圈主能踢
  if (s.role === 'owner' && actor.role !== 'owner') return { ok: false, msg: '只有圈主能踢掉圈主的会话' }
  await db.collection('admin_sessions').doc(sid).remove()
  tokenCache.delete(s.token)
  return { ok: true, username: s.username || '' }
}

async function accountRemove(username) {
  const u = String(username || '')
  if (u === ACTOR.name) return { ok: false, msg: '不能删自己' }
  const acc = await db.collection('admin_accounts').where({ username: u }).limit(1).get()
  const a = (acc.data || [])[0]
  if (!a) return { ok: false, msg: '账号不存在' }
  if (a.role === 'owner' && (await ownerCount()) <= 1) return { ok: false, msg: '至少要保留一个圈主' }
  await db.collection('admin_accounts').where({ username: u }).remove()
  try {
    await db.collection('admin_sessions').where({ username: u }).remove()
  } catch (err) {
    console.warn('删会话失败', err && err.message)
  }
  return { ok: true }
}

// ============ 审核（开发者的修改要管理员点通过） ============
async function approvalsList(event, actor) {
  const page = Math.max(1, Number(event.page) || 1)
  const pageSize = Math.min(50, Math.max(1, Number(event.pageSize) || 20))
  const status = String(event.status || '')
  const where = {}
  if (status) where.status = status
  // 开发者只能看到自己提交的审核单
  if (actor && actor.role === 'developer') where.requestedBy = actor.name
  let query = db.collection('approvals')
  if (Object.keys(where).length) query = query.where(where)
  const countRes = await query.count()
  const listRes = await query.orderBy('createdAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
  return {
    ok: true,
    list: (listRes.data || []).map(function (a) {
      return {
        id: a._id,
        action: a.action,
        payload: a.payload || {},
        requestedBy: a.requestedBy || '',
        requestedRole: a.requestedRole || '',
        status: a.status || 'pending',
        result: a.result || '',
        approvedBy: a.approvedBy || '',
        createdAt: ts(a.createdAt),
        handledAt: ts(a.approvedAt || a.rejectedAt),
      }
    }),
    total: countRes.total,
  }
}

async function approvalApprove(event, actor) {
  const id = String(event.id || '')
  if (!id) return { ok: false, msg: '缺少审核 id' }
  let doc
  try {
    doc = (await db.collection('approvals').doc(id).get()).data
  } catch (err) {
    return { ok: false, msg: '这条审核记录不存在' }
  }
  if (!doc) return { ok: false, msg: '这条审核记录不存在' }
  if (doc.status !== 'pending') return { ok: false, msg: '这条已经被处理过了' }

  await db.collection('approvals').doc(id).update({
    data: { status: 'approved', approvedBy: actor.name, approvedAt: db.serverDate() },
  })

  // 用管理员身份重新执行一次原动作（_fromApproval 防止再次进入审核）
  const payload = Object.assign({}, doc.payload || {}, { action: doc.action, token: event.token, _fromApproval: id })
  let res
  try {
    res = await exports.main(payload)
  } catch (err) {
    console.warn('审核重放失败', err && err.message)
    res = { ok: false, msg: (err && err.message) || '执行失败' }
  }

  const ok = !!(res && res.ok !== false)
  await db.collection('approvals').doc(id).update({
    data: { status: ok ? 'executed' : 'failed', result: ok ? '已执行' : ((res && res.msg) || '执行失败'), executedAt: db.serverDate() },
  })
  if (!ok) return { ok: false, msg: (res && res.msg) || '审核通过了，但执行失败' }
  return { ok: true, result: res }
}

async function approvalReject(id, reason) {
  const rid = String(id || '')
  if (!rid) return { ok: false, msg: '缺少审核 id' }
  const res = await db.collection('approvals').where({ _id: rid, status: 'pending' }).update({
    data: { status: 'rejected', result: String(reason || '管理员驳回了这次修改'), rejectedAt: db.serverDate() },
  })
  if (!res.stats.updated) return { ok: false, msg: '这条已经被处理过了' }
  return { ok: true }
}

// ============ 流量看板（内容与互动数据） ============
async function grabRecent(col, limit) {
  try {
    const r = await db.collection(col).orderBy('createdAt', 'desc').limit(limit).get()
    return r.data || []
  } catch (err) {
    return []
  }
}

async function analyticsOverview(event) {
  const days = Math.min(30, Math.max(7, Math.floor(Number(event.days)) || 7))
  const now = Date.now()
  const periods = seriesDays(now, days)
  const from = periods[0].from
  const packs = await Promise.all([
    grabRecent('posts', 1000),
    grabRecent('comments', 1000),
    grabRecent('users', 1000),
    grabRecent('likes', 1000),
    grabRecent('orders', 1000),
  ])
  const posts = packs[0]
  const comments = packs[1]
  const users = packs[2]
  const likes = packs[3]
  const orders = packs[4]
  const series = periods.map(({ key, from: start, to: end }) => {
    const bucket = { key, day: key.slice(5), posts: 0, comments: 0, users: 0 }
    posts.forEach(function (p) {
      const t = ts(p.createdAt)
      if (t >= start && t < end) bucket.posts++
    })
    comments.forEach(function (c) {
      const t = ts(c.createdAt)
      if (t >= start && t < end) bucket.comments++
    })
    users.forEach(function (u) {
      const t = ts(u.createdAt)
      if (t >= start && t < end) bucket.users++
    })
    return bucket
  })
  const last = series[series.length - 1]
  const today = { posts: last.posts, comments: last.comments, users: last.users }
  let totalViews = 0
  posts.forEach(function (p) { totalViews += Number(p.views || 0) })
  const active = {}
  posts.concat(comments).forEach(function (d) {
    if (d._openid && ts(d.createdAt) >= from) active[d._openid] = 1
  })
  const tagCount = {}
  posts.forEach(function (p) {
    ;(p.tags || []).forEach(function (t) { tagCount[t] = (tagCount[t] || 0) + 1 })
  })
  const topics = Object.keys(tagCount)
    .map(function (t) { return { tag: t, count: tagCount[t] } })
    .sort(function (a, b) { return b.count - a.count })
    .slice(0, 6)
  const brief = function (p) {
    return {
      id: p._id,
      content: String(p.content || '').slice(0, 40),
      nickname: p.nickname || '',
      views: Number(p.views || 0),
      likes: Number(p.likeCount || 0),
      comments: Number(p.commentCount || 0),
    }
  }
  const topPosts = posts.slice().sort(function (a, b) { return Number(b.views || 0) - Number(a.views || 0) }).slice(0, 5).map(brief)
  const topLiked = posts.slice().sort(function (a, b) { return Number(b.likeCount || 0) - Number(a.likeCount || 0) }).slice(0, 5).map(brief)
  return {
    ok: true,
    days: days,
    totals: {
      users: users.length,
      posts: posts.length,
      comments: comments.length,
      likes: likes.length,
      orders: orders.length,
      views: totalViews,
    },
    today: today,
    activeUsers: Object.keys(active).length,
    series: series,
    topics: topics,
    topPosts: topPosts,
    topLiked: topLiked,
  }
}

// ============ 广告位（首页 banner / 详情页底部）============
const AD_POSITIONS = ['home_banner', 'detail_bottom']
const AD_LINK_TYPES = ['none', 'post', 'page']

async function adsList() {
  try {
    const res = await db.collection('ads').orderBy('createdAt', 'desc').limit(100).get()
    return {
      ok: true,
      total: (res.data || []).length,
      list: (res.data || []).map(function (a) {
        return {
          id: a._id,
          title: a.title || '',
          image: a.image || '',
          position: a.position || 'home_banner',
          linkType: a.linkType || 'none',
          linkValue: a.linkValue || '',
          enabled: a.enabled !== false,
          weight: Number(a.weight || 0),
          startAt: ts(a.startAt),
          endAt: ts(a.endAt),
          views: Number(a.views || 0),
          clicks: Number(a.clicks || 0),
          createdAt: ts(a.createdAt),
        }
      }),
    }
  } catch (err) {
    return { ok: true, total: 0, list: [], msg: 'ads 集合还没建，先运行 setupCollections' }
  }
}

function adPayload(event) {
  const title = String(event.title || '').trim()
  const image = String(event.image || '').trim()
  const position = AD_POSITIONS.indexOf(event.position) > -1 ? event.position : 'home_banner'
  const linkType = AD_LINK_TYPES.indexOf(event.linkType) > -1 ? event.linkType : 'none'
  const linkValue = String(event.linkValue || '').trim()
  const weight = Math.min(100, Math.max(0, Number(event.weight) || 0))
  const startAt = Number(event.startAt) || 0
  const endAt = Number(event.endAt) || 0
  const enabled = event.enabled !== false
  return { title: title, image: image, position: position, linkType: linkType, linkValue: linkValue, weight: weight, startAt: startAt, endAt: endAt, enabled: enabled }
}

async function checkAdImage(image) {
  if (image.indexOf('cloud://') !== 0) {
    return { ok: false, msg: '广告图请用本小程序云存储里的图片（cloud:// 开头），外链图不接收' }
  }
  try {
    const f = await cloud.downloadFile({ fileID: image })
    const buf = f.fileContent
    if (!buf || !buf.length) return { ok: false, msg: '图片读不到，换一张试试' }
    if (buf.length > 750 * 1024) return { ok: false, msg: '图片超过 750KB，换一张小一点的' }
    let contentType = 'image/png'
    const lower = image.toLowerCase()
    if (lower.indexOf('.jpg') > -1 || lower.indexOf('.jpeg') > -1) contentType = 'image/jpeg'
    else if (lower.indexOf('.webp') > -1) contentType = 'image/webp'
    else if (lower.indexOf('.gif') > -1) contentType = 'image/gif'
    try {
      const res = await cloud.openapi.security.imgSecCheck({ media: { contentType: contentType, value: buf } })
      if (Number(res.errCode) === 87014) return { ok: false, msg: '这张广告图可能不太合适，换一张' }
    } catch (err) {
      const code = Number(err && (err.errCode || err.err_code))
      if (code === 87014) return { ok: false, msg: '这张广告图可能不太合适，换一张' }
      console.warn('广告图检测失败（先放行）', code, err && (err.errMsg || err.message))
      logSecFail('image', 'ad', err, image)
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, msg: '图片读不到（' + ((err && err.errCode) || '') + '），换一张试试' }
  }
}

async function adsSave(event) {
  const p = adPayload(event)
  if (!p.title) return { ok: false, msg: '标题不能为空' }
  if (!p.image) return { ok: false, msg: '图片地址不能为空' }
  const img = await checkAdImage(p.image)
  if (!img.ok) return img
  if (p.linkType === 'post' && !p.linkValue) return { ok: false, msg: '跳转帖子请填帖子 id' }
  if (p.linkType === 'page' && !p.linkValue) return { ok: false, msg: '跳转页面请填页面路径' }
  try {
    if (event.id) {
      await db.collection('ads').doc(String(event.id)).update({
        data: Object.assign({}, p, { updatedAt: db.serverDate() }),
      })
      return { ok: true, id: String(event.id) }
    }
    const added = await db.collection('ads').add({
      data: Object.assign({}, p, { views: 0, clicks: 0, createdAt: db.serverDate(), updatedAt: db.serverDate() }),
    })
    return { ok: true, id: added._id }
  } catch (err) {
    return { ok: false, msg: '保存失败：' + ((err && err.errMsg) || '未知错误') }
  }
}

async function adsRemove(id) {
  if (!id) return { ok: false, msg: '缺少广告 id' }
  try {
    await db.collection('ads').doc(String(id)).remove()
  } catch (err) {
    return { ok: false, msg: '这条广告不存在了' }
  }
  return { ok: true }
}

async function adsToggle(event) {
  if (!event.id) return { ok: false, msg: '缺少广告 id' }
  try {
    await db.collection('ads').doc(String(event.id)).update({
      data: { enabled: event.enabled !== false, updatedAt: db.serverDate() },
    })
  } catch (err) {
    return { ok: false, msg: '这条广告不存在了' }
  }
  return { ok: true }
}

// ============ exports.main ============
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = String(event.action || '')

  // Web 端用登录 token（带角色）；小程序端用 openid 白名单 / users.role
  const webUser = await resolveToken(event.token)
  const role = webUser ? (webUser.role || 'admin') : await roleOfOpenid(OPENID)
  const actor = role ? { name: (webUser && webUser.username) || '小程序管理员', role: role } : null
  ACTOR = actor || { name: '', role: '' }

  // 前端用它判断「我的」页要不要显示「管理台」入口，以及菜单显示哪些
  if (action === 'isAdmin') {
    return {
      ok: true,
      admin: !!actor,
      owner: role === 'owner',
      role: role || '',
      roleLabel: ROLE_LABEL[role] || '',
      username: actor ? actor.name : '',
    }
  }

  if (!actor) return { ok: false, msg: '你没有管理权限' }
  if (!allowRole(role, action)) {
    return { ok: false, msg: '当前身份（' + (ROLE_LABEL[role] || role) + '）没有这个操作的权限' }
  }

  // 开发者：修改类操作先提交给管理员审核
  if (role === 'developer' && MUTATIONS.indexOf(action) > -1 && !event._fromApproval) {
    const payload = {}
    Object.keys(event).forEach(function (k) {
      if (k !== 'token' && k !== 'action' && k !== '_fromApproval') payload[k] = event[k]
    })
    const add = await db.collection('approvals').add({
      data: {
        action: action,
        payload: payload,
        requestedBy: actor.name,
        requestedRole: role,
        status: 'pending',
        createdAt: db.serverDate(),
      },
    })
    await audit('approval.request', 'approval', add._id, action)
    return { ok: true, pending: true, approvalId: add._id, msg: '已提交给管理员审核，通过后才会生效' }
  }

  try {
    let res
    switch (action) {
      case 'dashboard':
        res = await dashboard(event)
        break
      case 'posts.list':
        res = await postsList(event)
        break
      case 'posts.setTop':
        res = await setPostTop(event.postId, event.top !== false)
        if (res.ok) await audit('posts.setTop', 'post', event.postId, event.top === false ? '取消置顶' : '置顶')
        break
      case 'posts.remove':
        res = await removePost(event.postId)
        if (res.ok) await audit('posts.remove', 'post', event.postId, '')
        break
      case 'comments.list':
        res = await commentsList(event)
        break
      case 'comments.remove':
        res = await removeComment(event.commentId)
        if (res.ok) await audit('comments.remove', 'comment', event.commentId, '')
        break
      case 'reports.list':
        res = await reportsList(event)
        break
      case 'reports.dismiss':
        res = await dismissReport(event.id)
        if (res.ok) await audit('reports.dismiss', 'report', event.id, '')
        break
      case 'reports.removePost': {
        // 先记下所有举报人（removePost 会连举报记录一起清掉，后查就没了）
        let reporters = []
        try {
          const rs = await db.collection('reports').where({ postId: event.postId }).limit(20).get()
          reporters = (rs.data || []).map(function (r) { return r._openid }).filter(Boolean)
        } catch (err) {
          console.warn('查举报人失败（不影响删帖）', err && err.message)
        }
        res = await removePost(event.postId)
        if (res.ok) {
          await audit('reports.removePost', 'post', event.postId, '')
          const openid = cloud.getWXContext().OPENID
          const seen = {}
          for (const rOpenid of reporters) {
            if (rOpenid !== openid && !seen[rOpenid]) {
              seen[rOpenid] = true
              await sendSystemNotice(rOpenid, '你举报的帖子已经被圈主删除了，感谢反馈～', event.postId, 'reportReplyText')
            }
          }
        }
        break
      }
      case 'users.list':
        res = await usersList(event)
        break
      case 'users.ban':
        res = await banUser(event.openid, event.reason)
        if (res.ok) await audit('users.ban', 'user', event.openid, event.reason || '')
        break
      case 'users.unban':
        res = await unbanUser(event.openid)
        if (res.ok) await audit('users.unban', 'user', event.openid, '')
        break
      case 'users.setRole':
        if (role !== 'owner') return { ok: false, msg: '只有圈主能任免管理员' }
        res = await setUserRole(event.openid, event.role)
        if (res.ok) await audit('users.setRole', 'user', event.openid, event.role || '取消管理员')
        break
      case 'feedback.list':
        res = await feedbackList(event)
        break
      case 'feedback.resolve':
        res = await feedbackResolve(event.id)
        if (res.ok) await audit('feedback.resolve', 'feedback', event.id, '')
        break
      case 'feedback.remove':
        res = await feedbackRemove(event.id)
        if (res.ok) await audit('feedback.remove', 'feedback', event.id, '')
        break
      case 'announcements.list':
        res = await announcementsList()
        break
      case 'announcements.create':
        res = await announcementSave(event, false)
        if (res.ok) await audit('announcements.create', 'announcement', res.id, event.title || '')
        await bumpConfigVersion()
        break
      case 'announcements.update':
        res = await announcementSave(event, true)
        if (res.ok) await audit('announcements.update', 'announcement', event.id, event.title || '')
        break
      case 'announcements.remove':
        res = await announcementRemove(event.id)
        if (res.ok) await audit('announcements.remove', 'announcement', event.id, '')
        break
      case 'settings.get':
        res = await settingsGet()
        break
      case 'settings.set':
        res = await settingsSet(event.key, event.value)
        if (res.ok) await audit('settings.set', 'setting', event.key, String(event.value || '').slice(0, 100))
        break
      case 'audit.list':
        res = await auditList(event)
        break
      case 'trash.list':
        res = await trashList(event)
        break
      case 'trash.restore':
        res = await restoreTrash(event.id)
        if (res.ok) await audit('trash.restore', event.type || 'trash', event.id, '')
        break
      case 'trash.purge':
        res = await purgeTrash(event.id)
        if (res.ok) await audit('trash.purge', event.type || 'trash', event.id, '')
        break
      case 'wordfilters.list':
        res = await wordsList()
        break
      case 'wordfilters.add':
        res = await wordsAdd(event.word)
        if (res.ok) {
          await syncWordlist()
          await audit('wordfilters.add', 'wordfilter', res.id, event.word || '')
        }
        break
      case 'wordfilters.remove':
        res = await wordsRemove(event.id)
        if (res.ok) {
          await syncWordlist()
          await audit('wordfilters.remove', 'wordfilter', event.id, '')
        }
        break
      case 'security.list':
        res = await securityList(event)
        break
      case 'backup.create':
        res = await backupCreate()
        if (res.ok) await audit('backup.create', 'backup', res.id, String(res.size || 0) + 'B')
        break
      case 'backup.list':
        res = await backupList()
        break
      case 'backup.download':
        res = await backupDownload(event.id)
        break
      case 'backup.restore': {
        res = await backupRestore(event)
        if (res.ok && !res.dryRun) {
          await audit('backup.restore', 'backup', event.id, JSON.stringify(res.collections))
        }
        break
      }
      case 'backup.remove':
        res = await backupRemove(event.id)
        if (res.ok) await audit('backup.remove', 'backup', event.id, '')
        break
      case 'analytics.overview':
        res = await analyticsOverview(event)
        break
      case 'ads.list':
        res = await adsList()
        break
      case 'ads.save':
        res = await adsSave(event)
        if (res.ok) await audit('ads.save', 'ad', res.id, event.title || '')
        break
      case 'ads.remove':
        res = await adsRemove(event.id)
        if (res.ok) await audit('ads.remove', 'ad', event.id, '')
        break
      case 'ads.toggle':
        res = await adsToggle(event)
        if (res.ok) await audit('ads.toggle', 'ad', event.id, event.enabled === false ? 'off' : 'on')
        break
      case 'posts.trace':
        res = await auditList({ targetId: event.postId, page: event.page, pageSize: event.pageSize })
        break
      case 'accounts.list':
        res = await accountsList()
        break
      case 'accounts.create':
        res = await accountCreate(event)
        if (res.ok) await audit('accounts.create', 'account', res.username, res.role)
        break
      case 'accounts.setRole':
        res = await accountSetRole(event.username, event.role)
        if (res.ok) await audit('accounts.setRole', 'account', event.username, event.role || '')
        break
      case 'accounts.setPassword':
        res = await accountSetPassword(event.username, event.password)
        if (res.ok) await audit('accounts.setPassword', 'account', event.username, '')
        break
      case 'accounts.setActive':
        res = await accountSetActive(event.username, event.active !== false, actor.name)
        if (res.ok) await audit('accounts.setActive', 'account', event.username, event.active === false ? '停用' : '启用')
        break
      case 'accounts.remove':
        res = await accountRemove(event.username)
        if (res.ok) await audit('accounts.remove', 'account', event.username, '')
        break
      case 'accounts.sessions':
        res = await sessionsList()
        break
      case 'accounts.revoke':
        res = await sessionRevoke(event.id, actor)
        if (res.ok) await audit('accounts.revoke', 'session', res.username || event.id, '')
        break
      case 'approvals.list':
        res = await approvalsList(event, actor)
        break
      case 'approvals.approve':
        res = await approvalApprove(event, actor)
        if (res.ok) await audit('approvals.approve', 'approval', event.id, '')
        break
      case 'approvals.reject':
        res = await approvalReject(event.id, event.reason)
        if (res.ok) await audit('approvals.reject', 'approval', event.id, event.reason || '')
        break
      default:
        return { ok: false, msg: '不认识的操作：' + action }
    }
    return res
  } catch (err) {
    console.error('adminApi 出错', action, err)
    return { ok: false, msg: (err && err.errMsg) || '操作失败，看云函数日志' }
  }
}
