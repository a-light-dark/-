// 云函数：reportPost —— 举报帖子
// 为什么用云函数：举报记录要写进 reports 集合（客户端没有写他人数据的权限），
// 顺便做理由白名单和「同一个人重复举报不重复记」。
const crypto = require('crypto')
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

  const commentId = String(event.commentId || '')
  const isComment = Boolean(commentId)
  const type = isComment ? 'comment' : 'post'
  const label = isComment ? '评论' : '帖子'
  const targetId = commentId || postId
  const targets = db.collection(isComment ? 'comments' : 'posts')
  const target = (await targets.where({ _id: targetId }).limit(1).get()).data[0]
  if (!target || (isComment && target.postId !== postId)) {
    return { ok: false, msg: label + '不存在或已删除' }
  }
  if (target._openid === OPENID) return { ok: false, msg: '不能举报自己的' + label }

  const reports = db.collection('reports')
  const match = { _openid: OPENID, postId }
  if (isComment) match.commentId = commentId
  else match.targetType = db.command.neq('comment') // 兼容没有类型字段的历史举报
  const exists = async () => (await reports.where(match).limit(1).get()).data.length > 0
  if (await exists()) return { ok: true, duplicate: true }

  const rate = await checkRate(db.collection('rate_limits'), 'report_' + OPENID, 5, 60000)
  if (!rate.ok) return rate

  const id = crypto.createHash('sha256').update(JSON.stringify([OPENID, type, targetId])).digest('hex').slice(0, 32)
  try {
    await reports.add({ data: {
      _id: id, _openid: OPENID, targetType: type, postId, commentId, reason, createdAt: db.serverDate(),
    } })
  } catch (err) {
    if (await exists()) return { ok: true, duplicate: true }
    throw err
  }
  return { ok: true }
}
