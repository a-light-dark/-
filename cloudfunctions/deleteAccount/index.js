// cloudfunctions/deleteAccount/index.js —— 注销账号：删除本人的资料与内容
// 顺序：先拦「还有没结束的互助订单」，再按依赖顺序删数据
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

// 删除某个集合里满足条件的所有记录（集合不存在也不报错）
async function removeWhere(collection, where, required = false) {
  try {
    const res = await db.collection(collection).where(where).remove()
    return (res.stats && res.stats.removed) || 0
  } catch (err) {
    console.warn('[deleteAccount] remove ' + collection + ' failed', err.errCode, err.errMsg)
    if (required) throw err
    return 0
  }
}

// 把一批 postId 按帖子分组，返回 { postId: count }
function groupByPost(list) {
  const map = {}
  list.forEach(function (row) {
    const key = row.postId || ''
    if (!key) return
    map[key] = (map[key] || 0) + 1
  })
  return map
}

// 批量删云存储文件（一次最多 50 个，失败只记日志）
async function removeFiles(fileIDs) {
  const list = (fileIDs || [])
    .map(function (id) { return String(id || '') })
    .filter(function (id) { return id.indexOf('cloud://') === 0 })
  if (!list.length) return 0
  let removed = 0
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50)
    try {
      const res = await cloud.deleteFile({ fileList: chunk })
      removed += (res.fileList || []).length
    } catch (err) {
      console.warn('[deleteAccount] deleteFile failed', err && err.errCode, err && err.errMsg)
    }
  }
  return removed
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, msg: '没有拿到你的身份，请重进小程序再试' }

  // 1. 还有进行中的订单就不让注销（订单涉及另一位同学）
  const active = await db.collection('orders').where(_.or([
    { _openid: OPENID, status: _.in(['待接单', '已接单', '待确认']) },
    { takerOpenid: OPENID, status: _.in(['已接单', '待确认']) },
  ])).count()
  if (active.total > 0) {
    return { ok: false, msg: '你还有 ' + active.total + ' 个互助订单没结束，处理完再注销' }
  }

  // 先清理关联记录；部分失败时保留账号，用户可安全重试剩余清理。
  // audit_logs / security_alerts 属审计记录，按审计留存要求保留，用于合规核查与排障。
  let deletedFollows, deletedReviews, deletedFeedback
  try {
    deletedFollows = await removeWhere('follows', { _openid: OPENID }, true)
    deletedReviews = await removeWhere('reviews', { fromOpenid: OPENID }, true)
    deletedReviews += await removeWhere('reviews', { toOpenid: OPENID }, true)
    deletedFeedback = await removeWhere('feedback', { _openid: OPENID }, true)
  } catch (err) {
    return { ok: false, msg: '关联数据暂未清理完，请稍后重试注销' }
  }

  // 2. 我发的帖子：连评论 / 点赞 / 收藏 / 通知 / 举报一并删掉
  const myPosts = await db.collection('posts').where({ _openid: OPENID }).limit(200).get()
  const postIds = myPosts.data.map(function (p) { return p._id })
  const myFiles = []
  myPosts.data.forEach(function (p) {
    (p.images || []).forEach(function (fid) { myFiles.push(fid) })
  })
  // 头像也一起删（avatars/<openid>/ 下自己传的图）
  try {
    const me = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
    const avatar = me.data && me.data[0] && me.data[0].avatar
    if (avatar && avatar.indexOf('cloud://') === 0 && avatar.indexOf('avatars/' + OPENID + '/') > -1) {
      myFiles.push(avatar)
    }
  } catch (err) {
    console.warn('[deleteAccount] 读取头像失败', err && err.errCode, err && err.errMsg)
  }
  let removedPosts = 0
  for (let i = 0; i < postIds.length; i++) {
    const postId = postIds[i]
    await removeWhere('comments', { postId: postId })
    await removeWhere('likes', { postId: postId })
    await removeWhere('favorites', { postId: postId })
    await removeWhere('notices', { postId: postId })
    await removeWhere('reports', { postId: postId })
  }
  removedPosts = await removeWhere('posts', { _openid: OPENID })

  // 3. 我在别人帖子下的评论：删评论，同时把对应帖子的评论数减掉
  const myComments = await db.collection('comments').where({ _openid: OPENID }).limit(500).get()
  const commentMap = groupByPost(myComments.data)
  for (const postId in commentMap) {
    try {
      await db.collection('posts').doc(postId).update({ data: { commentCount: _.inc(-commentMap[postId]) } })
    } catch (err) {
      console.warn('[deleteAccount] dec commentCount failed', postId)
    }
  }
  await removeWhere('comments', { _openid: OPENID })

  // 4. 我的点赞：删记录，同时把对应帖子的点赞数减掉
  const myLikes = await db.collection('likes').where({ _openid: OPENID }).limit(1000).get()
  const likeMap = groupByPost(myLikes.data)
  for (const postId in likeMap) {
    try {
      await db.collection('posts').doc(postId).update({ data: { likeCount: _.inc(-likeMap[postId]) } })
    } catch (err) {
      console.warn('[deleteAccount] dec likeCount failed', postId)
    }
  }
  await removeWhere('likes', { _openid: OPENID })

  // 5. 收藏、通知（发给我的 + 我发出的）、举报记录
  await removeWhere('favorites', { _openid: OPENID })
  await removeWhere('notices', { toOpenid: OPENID })
  await removeWhere('notices', { _openid: OPENID })
  await removeWhere('reports', { _openid: OPENID })

  // 6. 最后删用户资料
  await removeWhere('users', { _openid: OPENID })

  // 7. 清云存储：自己帖子的图 + 头像（失败不影响注销结果）
  const filesRemoved = await removeFiles(myFiles)

  return { ok: true, deletedPosts: removedPosts, filesRemoved, deletedFollows, deletedReviews, deletedFeedback }
}
