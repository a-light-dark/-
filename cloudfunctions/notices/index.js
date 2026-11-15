// 云函数：notices —— 消息通知的读取/已读
// 为什么用云函数：notice 文档是「别人」写给你 的（_openid 是发送者），
// 按「仅创建者可读写」客户端读不到自己的通知，只能由服务端按 toOpenid 查。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const PAGE = 50

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = String(event.action || 'list')
  const notices = db.collection('notices')

  // 未读数（tab 红点用）
  if (action === 'unread') {
    const res = await notices.where({ toOpenid: OPENID, read: false }).count()
    return { ok: true, count: res.total }
  }

  // 一键已读
  if (action === 'readAll') {
    const res = await notices.where({ toOpenid: OPENID, read: false }).update({ data: { read: true } })
    return { ok: true, updated: (res.stats && res.stats.updated) || 0 }
  }

  // 单条已读（点进消息时）
  if (action === 'read') {
    const noticeId = String(event.noticeId || '')
    if (!noticeId) return { ok: false, msg: '缺少消息 id' }
    const res = await notices.where({ _id: noticeId, toOpenid: OPENID }).update({ data: { read: true } })
    return { ok: true, updated: (res.stats && res.stats.updated) || 0 }
  }

  // 列表（最新的 50 条）
  const res = await notices.where({ toOpenid: OPENID }).orderBy('createdAt', 'desc').limit(PAGE).get()
  const list = (res.data || []).map(function (doc) {
    return {
      id: doc._id,
      type: doc.type || 'comment',
      text: doc.text || '',
      fromNickname: doc.fromNickname || '同学',
      fromAvatar: doc.fromAvatar || '😀',
      postId: doc.postId || '',
      orderId: doc.orderId || '',
      read: !!doc.read,
      ts: doc.createdAt ? Number(new Date(doc.createdAt).getTime()) : 0,
    }
  })
  return { ok: true, list: list }
}
