// 云函数：likePost —— 点赞 / 取消点赞
// 为什么必须用云函数：帖子可能是别人发的，客户端没有权限改别人的 likeCount。
// 点赞记录存在 likes 集合：一个用户对一条帖子只会有一条记录（取消点赞就删掉）。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const postId = String(event.postId || '')
  if (!postId) return { liked: false, likeCount: 0, msg: '缺少 postId' }

  const likes = db.collection('likes')
  const posts = db.collection('posts')

  const exist = await likes.where({ postId, _openid: OPENID }).limit(1).get()

  let liked = false
  if (exist.data && exist.data.length > 0) {
    // 已经点过 → 取消点赞
    await likes.doc(exist.data[0]._id).remove()
    await posts.doc(postId).update({ data: { likeCount: _.inc(-1) } })
    liked = false
  } else {
    await likes.add({ data: { postId, _openid: OPENID } })
    await posts.doc(postId).update({ data: { likeCount: _.inc(1) } })
    liked = true
  }

  const post = await posts.doc(postId).get()
  const likeCount = Math.max(0, (post.data && post.data.likeCount) || 0)

  // 只有「点了赞」才通知作者（取消赞不通知），也不通知自己
  if (liked && post.data && post.data._openid && post.data._openid !== OPENID) {
    try {
      let nickname = '同学'
      let avatar = '😀'
      const user = await db.collection('users').where({ _openid: OPENID }).limit(1).get().catch(function () { return null })
      if (user && user.data && user.data[0]) {
        nickname = user.data[0].nickname || nickname
        avatar = user.data[0].avatar || avatar
      }
      await db.collection('notices').add({
        data: {
          toOpenid: post.data._openid,
          type: 'like',
          postId: postId,
          fromNickname: nickname,
          fromAvatar: avatar,
          text: '赞了你的帖子',
          read: false,
          createdAt: db.serverDate(),
        },
      })
    } catch (err) {
      console.warn('写点赞通知失败（不影响点赞）', err && err.errMsg)
    }
  }

  return { liked, likeCount }
}
