// 云函数：deleteComment —— 删除自己的评论（删顶层评论时连同它的回复一起删）
// 拆分出来是为了职责单一：addComment 只管发评论，deleteComment 只管删。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const commentId = String(event.commentId || '')
  if (!commentId) return { ok: false, msg: '缺少评论 id' }

  let doc = null
  try {
    const res = await db.collection('comments').doc(commentId).get()
    doc = res.data
  } catch (err) {
    return { ok: false, msg: '评论不存在或已删除' }
  }
  if (!doc) return { ok: false, msg: '评论不存在或已删除' }
  if (doc._openid !== OPENID) return { ok: false, msg: '只能删自己的评论' }

  let removed = 1
  if (!doc.parentId) {
    try {
      const replies = await db.collection('comments').where({ parentId: commentId }).get()
      if (replies.data && replies.data.length) {
        await db.collection('comments').where({ parentId: commentId }).remove()
        removed += replies.data.length
      }
    } catch (err) {
      console.warn('收集子回复失败（继续删主评论）', err)
    }
  }

  try {
    await db.collection('comments').doc(commentId).remove()
  } catch (err) {
    return { ok: false, msg: '删除失败，稍后再试' }
  }

  if (doc.postId) {
    try {
      await db.collection('posts').doc(String(doc.postId)).update({
        data: { commentCount: _.inc(-removed) },
      })
    } catch (err) {
      console.warn('评论数回补失败', err)
    }
  }

  return { ok: true, removed: removed }
}
