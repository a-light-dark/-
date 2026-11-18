// 帖子详情一次拿全：正文 + 是否点赞/收藏 + 第一页评论 + 详情页广告
// 以前是 fetchPost + fetchComments + incView 三次云函数调用，现在合并成一次
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const postId = String(event.postId || '').trim()
  if (!postId) return { ok: false, msg: '缺少帖子 id' }

  let post = null
  try {
    const r = await db.collection('posts').doc(postId).get()
    post = r.data
  } catch (err) {
    return { ok: false, msg: '帖子不存在或已删除' }
  }

  let views = Number(post.views || 0)
  if (event.withView !== false) {
    try {
      await db.collection('posts').doc(postId).update({ data: { views: _.inc(1) } })
      views = views + 1
    } catch (err) {
      console.warn('浏览数没加上', err && err.errCode)
    }
  }

  let liked = false
  try {
    const l = await db.collection('likes').where({ postId: postId, _openid: OPENID }).limit(1).get()
    liked = !!(l.data && l.data.length)
  } catch (err) {}

  let favorited = false
  try {
    const f = await db.collection('favorites').where({ postId: postId, _openid: OPENID }).limit(1).get()
    favorited = !!(f.data && f.data.length)
  } catch (err) {}

  let comments = []
  try {
    const c = await db.collection('comments').where({ postId: postId }).orderBy('createdAt', 'desc').limit(100).get()
    comments = c.data || []
  } catch (err) {}

  let ad = null
  try {
    const now = Date.now()
    const a = await db.collection('ads').where({ enabled: true, position: 'detail_bottom' }).limit(10).get()
    const list = (a.data || [])
      .filter(function (x) {
        const start = Number(x.startAt) || 0
        const end = Number(x.endAt) || 0
        return (!start || start <= now) && (!end || end >= now)
      })
      .sort(function (x, y) { return (Number(y.weight) || 0) - (Number(x.weight) || 0) })
    if (list.length) {
      const x = list[0]
      ad = {
        id: x._id,
        title: x.title || '',
        image: x.image || '',
        position: 'detail_bottom',
        linkType: x.linkType || 'none',
        linkValue: x.linkValue || '',
        startAt: Number(x.startAt) || 0,
        endAt: Number(x.endAt) || 0,
      }
    }
  } catch (err) {}

  return {
    ok: true,
    post: Object.assign({}, post, { id: post._id, views: views }),
    liked: liked,
    favorited: favorited,
    comments: comments,
    commentCount: Number(post.commentCount || 0),
    ad: ad,
  }
}
