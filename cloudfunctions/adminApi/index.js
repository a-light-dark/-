// 云函数 adminApi —— 管理后台网关（只有管理员能用）
// 设计参考 CampusHub 的「资源型网关」思路：把后台的所有动作收敛到一个函数里，
// 前端（小程序管理台 / 将来的 Web 后台）统一调这一个函数，按 event.action 分发。
// 所有管理动作都会写 audit_logs（谁、什么时候、对什么、做了什么）。

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
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
async function dashboard() {
  const [posts, comments, orders, users, reportsCount, feedbackPending, todayPosts, todayComments] = await Promise.all([
    db.collection('posts').count(),
    db.collection('comments').count(),
    db.collection('orders').count(),
    db.collection('users').count(),
    db.collection('reports').count(),
    db.collection('feedback').where({ status: '待处理' }).count(),
    db.collection('posts').where({ createdAt: _.gte(new Date(new Date().setHours(0, 0, 0, 0))) }).count(),
    db.collection('comments').where({ createdAt: _.gte(new Date(new Date().setHours(0, 0, 0, 0))) }).count(),
  ])
  let trashCount = 0
  try {
    const t = await db.collection('trash').count()
    trashCount = t.total
  } catch (err) {
    console.warn('回收站计数失败（集合可能还没建）', err && err.errCode)
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

  return {
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
      recentReports: reports.map(function (r) {
        return { id: r._id, reason: r.reason, createdAt: ts(r.createdAt), post: postMap[r.postId] || null }
      }),
    },
  }
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
  const [countRes, listRes] = await Promise.all([
    query.count(),
    query.orderBy('createdAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get(),
  ])
  const list = (listRes.data || []).map(function (p) {
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
  return { ok: true, list: list, total: countRes.total, hasMore: page * pageSize < countRes.total }
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

// ============ 举报处理 ============
async function reportsList() {
  const res = await db.collection('reports').orderBy('createdAt', 'desc').limit(50).get()
  const reports = res.data || []
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
  }
}

async function dismissReport(id) {
  if (!id) return { ok: false, msg: '缺少举报 id' }
  await db.collection('reports').doc(id).remove()
  return { ok: true }
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
  return {
    ok: true,
    list: (listRes.data || []).map(function (u) {
      return {
        openid: u._openid || '',
        nickname: u.nickname,
        avatar: u.avatar,
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
async function feedbackList() {
  const res = await db.collection('feedback').orderBy('createdAt', 'desc').limit(50).get()
  return {
    ok: true,
    list: (res.data || []).map(function (f) {
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
  }
}

async function feedbackResolve(id) {
  if (!id) return { ok: false, msg: '缺少反馈 id' }
  const res = await db.collection('feedback').doc(id).update({ data: { status: '已处理', resolvedAt: db.serverDate() } })
  if (!res.stats || res.stats.updated === 0) return { ok: false, msg: '这条反馈不存在或已经处理过了' }
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
  const countRes = await db.collection('audit_logs').count()
  const listRes = await db.collection('audit_logs').orderBy('at', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
  return {
    ok: true,
    list: (listRes.data || []).map(function (a) {
      return { id: a._id, action: a.action, targetType: a.targetType, targetId: a.targetId, detail: a.detail, at: ts(a.at) }
    }),
    total: countRes.total,
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = String(event.action || '')

  // 前端用它判断「我的」页要不要显示「管理台」入口
  if (action === 'isAdmin') {
    return { ok: true, admin: isAdmin(OPENID), owner: isOwner(OPENID) }
  }

  if (!isAdmin(OPENID)) {
    return { ok: false, msg: '你没有管理权限' }
  }

  try {
    let res
    switch (action) {
      case 'dashboard':
        res = await dashboard()
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
        res = await reportsList()
        break
      case 'reports.dismiss':
        res = await dismissReport(event.id)
        if (res.ok) await audit('reports.dismiss', 'report', event.id, '')
        break
      case 'reports.removePost':
        res = await removePost(event.postId)
        if (res.ok) await audit('reports.removePost', 'post', event.postId, '')
        break
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
        if (!isOwner(OPENID)) return { ok: false, msg: '只有超管能任免管理员' }
        res = await setUserRole(event.openid, event.role)
        if (res.ok) await audit('users.setRole', 'user', event.openid, event.role || '取消管理员')
        break
      case 'feedback.list':
        res = await feedbackList()
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
      default:
        return { ok: false, msg: '不认识的操作：' + action }
    }
    return res
  } catch (err) {
    console.error('adminApi 出错', action, err)
    return { ok: false, msg: (err && err.errMsg) || '操作失败，看云函数日志' }
  }
}
