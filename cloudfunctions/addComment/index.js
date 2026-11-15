// 云函数：addComment —— 发评论（先做内容安全检测），同时给帖子的评论数 +1
// 为什么用云函数：评论人不是帖子作者，客户端没权限改帖子上的 commentCount。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function checkText(content, scene, openid) {
  try {
    const res = await cloud.openapi.security.msgSecCheck({
      content: String(content || '').slice(0, 2500),
      version: 2,
      scene: scene,
      openid: openid,
    })
    const suggest = (res.result && res.result.suggest) || 'pass'
    return { ok: suggest === 'pass', suggest: suggest }
  } catch (err) {
    console.warn('msgSecCheck 调用失败（先放行）', err && err.errCode, err && err.errMsg)
    return { ok: true, apiError: true }
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const postId = String(event.postId || '')
  const content = String(event.content || '').trim()
  if (!postId || !content) return { ok: false, msg: '参数不完整' }
  if (content.length > 300) return { ok: false, msg: '评论太长啦，300 字以内' }

  // 昵称头像优先用 users 里的最新资料，客户端传的只当兜底
  let nickname = event.nickname || '同学'
  let avatar = event.avatar || '😀'
  try {
    const user = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
    if (user.data && user.data[0]) {
      nickname = user.data[0].nickname || nickname
      avatar = user.data[0].avatar || avatar
    }
  } catch (err) {
    console.warn('读取用户资料失败', err && err.errMsg)
  }

  const check = await checkText(content, 2, OPENID) // scene 2 = 评论
  if (!check.ok) return { ok: false, msg: '评论可能不太合适，换个说法再试试', suggest: check.suggest }

  // 先看帖子作者是谁：评论成功要给他发一条消息通知
  const postDoc = await db.collection('posts').doc(postId).get().catch(function () { return null })
  const postOwner = postDoc && postDoc.data && postDoc.data._openid

  const res = await db.collection('comments').add({
    data: {
      postId,
      content,
      nickname,
      avatar,
      createdAt: db.serverDate(),
      // 云函数写入不会自动带 _openid，手动补上，方便以后按作者查
      _openid: OPENID,
    },
  })

  await db.collection('posts').doc(postId).update({ data: { commentCount: _.inc(1) } })

  // 通知帖子作者（不通知自己）
  if (postOwner && postOwner !== OPENID) {
    try {
      await db.collection('notices').add({
        data: {
          toOpenid: postOwner,
          type: 'comment',
          postId: postId,
          fromNickname: nickname,
          fromAvatar: avatar,
          text: '评论了你的帖子：' + content.slice(0, 40),
          read: false,
          createdAt: db.serverDate(),
        },
      })
    } catch (err) {
      console.warn('写评论通知失败（不影响评论）', err && err.errMsg)
    }
  }

  return { ok: true, id: res._id, nickname: nickname, avatar: avatar }
}
