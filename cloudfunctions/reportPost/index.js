// 云函数：reportPost —— 举报帖子
// 为什么用云函数：举报记录要写进 reports 集合（客户端没有写他人数据的权限），
// 顺便做理由白名单和「同一个人重复举报不重复记」。
const cloud = require('wx-server-sdk')
const { checkRate } = require('./lib/limit')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 和详情页弹出来的理由保持一致
const REASONS = ['垃圾广告', '色情低俗', '人身攻击', '不实信息', '其他']

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, msg: '没有拿到你的身份，请重进小程序' }
  const postId = String(event.postId || '')
  const reason = String(event.reason || '')

  if (!postId) return { ok: false, msg: '缺少帖子 id' }
  if (REASONS.indexOf(reason) === -1) return { ok: false, msg: '举报理由不对' }

  // 自己举报自己没意义，直接拦掉
  const post = await db.collection('posts').doc(postId).get().catch(function () { return null })
  if (!post || !post.data) return { ok: false, msg: '帖子不存在或已删除' }
  if (post.data._openid === OPENID) return { ok: false, msg: '不能举报自己的帖子' }

  // 同一个人对同一条帖子只记一条
  const exist = await db.collection('reports').where({ postId, _openid: OPENID }).limit(1).get()
  if ((exist.data || []).length) return { ok: true, duplicate: true }

  const rate = await checkRate(db.collection('rate_limits'), 'report_' + OPENID, 5, 60000)
  if (!rate.ok) return rate

  await db.collection('reports').add({
    data: {
      postId: postId,
      reason: reason,
      createdAt: db.serverDate(),
      _openid: OPENID,
    },
  })

  return { ok: true }
}
