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
      wordCount: wordCount,
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

// ============ 敏感词库 ============
async function wordsList() {
  const res = await db.collection('wordfilters').orderBy('createdAt', 'desc').limit(200).get()
  return {
    ok: true,
    list: (res.data || []).map(function (w) {
      return { id: w._id, word: w.word, createdAt: ts(w.createdAt) }
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

// ============ 举报处理 ============
async function reportsList(event) {
  const page = Math.max(1, Number(event && event.page) || 1)
  const pageSize = Math.min(50, Math.max(5, Number(event && event.pageSize) || 20))
  const countRes = await db.collection('reports').count()
  const total = countRes.total || 0
  const res = await db.collection('reports').orderBy('createdAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
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
    total: total,
    page: page,
    pageSize: pageSize,
    hasMore: page * pageSize < total,
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
async function feedbackList(event) {
  const page = Math.max(1, Number(event && event.page) || 1)
  const pageSize = Math.min(50, Math.max(5, Number(event && event.pageSize) || 20))
  const countRes = await db.collection('feedback').count()
  const total = countRes.total || 0
  const res = await db.collection('feedback').orderBy('createdAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
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
    total: total,
    page: page,
    pageSize: pageSize,
    hasMore: page * pageSize < total,
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
        if (!isOwner(OPENID)) return { ok: false, msg: '只有超管能任免管理员' }
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
        if (res.ok) await audit('wordfilters.add', 'wordfilter', res.id, event.word || '')
        break
      case 'wordfilters.remove':
        res = await wordsRemove(event.id)
        if (res.ok) await audit('wordfilters.remove', 'wordfilter', event.id, '')
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
      case 'backup.remove':
        res = await backupRemove(event.id)
        if (res.ok) await audit('backup.remove', 'backup', event.id, '')
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
