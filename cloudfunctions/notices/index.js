// 云函数：notices —— 消息通知的读取/已读
// 为什么用云函数：notice 文档是「别人」写给你 的（_openid 是发送者），
// 按「仅创建者可读写」客户端读不到自己的通知，只能由服务端按 toOpenid 查。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const PAGE = 50

// 单条通知转成前端要的格式
function toRow(doc) {
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
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = String(event.action || 'list')
  const notices = db.collection('notices')

  // 消息页首屏：一次调用同时返回「列表 + 未读数」，省掉两次往返
  if (action === 'bundle') {
    const [listRes, unreadRes] = await Promise.all([
      notices.where({ toOpenid: OPENID }).orderBy('createdAt', 'desc').limit(PAGE).get(),
      notices.where({ toOpenid: OPENID, read: false }).count(),
    ])
    return {
      ok: true,
      list: (listRes.data || []).map(toRow),
      unread: unreadRes.total || 0,
    }
  }

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

  // 删除一条通知（只能删自己的），长按消息卡用
  if (action === 'remove') {
    const noticeId = String(event.noticeId || '')
    if (!noticeId) return { ok: false, msg: '缺少消息 id' }
    const res = await notices.where({ _id: noticeId, toOpenid: OPENID }).remove()
    const removed = (res.stats && res.stats.removed) || 0
    if (!removed) return { ok: false, msg: '这条消息不见了' }
    return { ok: true, removed: removed }
  }

  // 列表（最新的 50 条）；type 传 comment/like/order 就只看那一类
  const type = String(event.type || '')
  const where = { toOpenid: OPENID }
  if (type && type !== 'all') where.type = type
  const res = await notices.where(where).orderBy('createdAt', 'desc').limit(PAGE).get()
  return { ok: true, list: (res.data || []).map(toRow) }
}
