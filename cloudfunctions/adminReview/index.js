// 云函数 adminReview —— 举报处理（只有管理员能用）
// 为什么要云函数：要删「别人发的帖子」，客户端没这个权限，也不能信任客户端自称管理员。

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

// 管理员 openid 白名单：想加人就把 openid 加进来
const ADMIN_OPENIDS = [
  'oO3Q4xlLjdjHG-yb77GFRSkzTWsU', // 圈主本人
]

function isAdmin(openid) {
  return ADMIN_OPENIDS.indexOf(openid) > -1
}

// 读举报列表：顺带把被举报的帖子一起读出来，前端不用再查一次
async function listReports() {
  const res = await db.collection('reports').where({ targetType: _.neq('comment') }).orderBy('createdAt', 'desc').limit(50).get()
  const reports = res.data || []
  const postIds = reports.map((r) => r.postId).filter(Boolean)

  let posts = []
  if (postIds.length) {
    const postRes = await db.collection('posts').where({ _id: _.in(postIds) }).limit(100).get()
    posts = postRes.data || []
  }

  const postMap = {}
  posts.forEach((p) => {
    postMap[p._id] = {
      _id: p._id,
      content: p.content,
      nickname: p.nickname,
      avatar: p.avatar,
      images: p.images || [],
      createdAt: p.createdAt,
    }
  })

  return reports.map((r) => ({
    id: r._id,
    postId: r.postId,
    reason: r.reason,
    createdAt: r.createdAt ? new Date(r.createdAt).getTime() : 0,
    post: postMap[r.postId] || null, // 帖子已经被删就是 null
  }))
}

// 删帖：删掉帖子和挂在它上面的评论 / 点赞 / 收藏 / 举报，最后清掉云存储里的图
async function deletePost(postId) {
  if (!postId) return { ok: false, msg: '缺少帖子 id' }

  // 先读出图片，删完数据库记录就查不到了
  let images = []
  try {
    const doc = await db.collection('posts').doc(postId).get()
    images = (doc && doc.data && doc.data.images) || []
  } catch (err) {
    console.warn('读取帖子图片失败（可能已删除）', postId)
  }

  try {
    await db.collection('posts').doc(postId).remove()
  } catch (err) {
    // 帖子可能已经被作者自己删了，继续清理关联数据
    console.warn('删帖失败（可能已删除）', postId, err.errCode)
  }

  // 收藏记录保留：别人收藏里会显示「帖子已被删除」，由本人决定要不要清掉
  await Promise.all([
    db.collection('comments').where({ postId: postId }).remove(),
    db.collection('likes').where({ postId: postId }).remove(),
    db.collection('reports').where({ postId: postId }).remove(),
    db.collection('notices').where({ postId: postId }).remove(),
  ])

  const files = (images || [])
    .map(function (id) { return String(id || '') })
    .filter(function (id) { return id.indexOf('cloud://') === 0 })
  if (files.length) {
    try {
      await cloud.deleteFile({ fileList: files })
    } catch (err) {
      console.warn('删除帖子图片失败', err && err.errCode, err && err.errMsg)
    }
  }

  return { ok: true }
}

// 忽略举报：只把举报记录删掉，帖子保留
async function dismissReport(id) {
  if (!id) return { ok: false, msg: '缺少举报 id' }
  await db.collection('reports').doc(id).remove()
  return { ok: true }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = String(event.action || '')

  // 前端用它判断「我的」页要不要显示「举报处理」入口
  if (action === 'isAdmin') {
    return { ok: true, admin: isAdmin(OPENID) }
  }

  if (!isAdmin(OPENID)) {
    return { ok: false, msg: '你没有管理权限' }
  }

  try {
    if (action === 'listReports') {
      const list = await listReports()
      return { ok: true, list: list }
    }
    if (action === 'deletePost') {
      return await deletePost(event.postId)
    }
    if (action === 'dismissReport') {
      return await dismissReport(event.id)
    }
    return { ok: false, msg: '不认识的操作：' + action }
  } catch (err) {
    console.error('adminReview 出错', action, err)
    return { ok: false, msg: (err && err.errMsg) || '操作失败，看云函数日志' }
  }
}
