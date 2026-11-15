// 云函数：likePost —— 点赞 / 取消点赞
// 为什么必须用云函数：帖子可能是别人发的，客户端没有权限改别人的 likeCount。
// 点赞记录存在 likes 集合：一个用户对一条帖子只会有一条记录（取消点赞就删掉）。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 订阅消息模板 ID：和 miniprogram/utils/subscribe.js 里保持一致；留空就跳过推送
const TEMPLATE_IDS = {
  comment: '',
  like: '',
  order: '',
}
const MINIPROGRAM_STATE = 'developer' // 体验版改 trial，正式版改 formal

function nowText() {
  const d = new Date(Date.now() + 8 * 3600 * 1000)
  const pad = function (n) { return n < 10 ? '0' + n : '' + n }
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) +
    ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes())
}

async function subscribeNotify(toOpenid, kind, page, data) {
  const templateId = TEMPLATE_IDS[kind]
  if (!templateId || !toOpenid) return
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: toOpenid,
      templateId: templateId,
      page: page,
      lang: 'zh_CN',
      miniprogramState: MINIPROGRAM_STATE,
      data: data,
    })
  } catch (err) {
    console.warn('订阅消息发送失败（不影响主流程）', kind, err && err.errCode, err && err.errMsg)
  }
}

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
    let nickname = '同学'
    let avatar = '😀'
    try {
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

    // 顺带发一条订阅消息（用户在消息页授权过才会收到）
    await subscribeNotify(post.data._openid, 'like', 'pages/detail/detail?id=' + postId, {
      thing1: { value: '赞了你的帖子' },
      thing2: { value: nickname + ' 刚刚点了赞' },
      time3: { value: nowText() },
    })
  }

  return { liked, likeCount }
}
