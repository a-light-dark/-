// 云函数：orderReview —— 订单互评
// action=create  ：给这单的对方打分（1-5 星 + 一句评价），只允许订单双方、且订单已完成、每人只能评一次
// action=ofOrder ：查这条订单的评价（含「我评过没有」，决定要不要显示评价按钮）
// action=list    ：查某个用户收到的评价（个人主页显示平均分）
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function toTs(value) {
  if (!value) return Date.now()
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  const t = new Date(value).getTime()
  return isNaN(t) ? Date.now() : t
}

// 我自己的昵称头像（写通知用）
async function myProfile(openid) {
  try {
    const res = await db.collection('users').where({ _openid: openid }).limit(1).get()
    const u = (res.data || [])[0] || {}
    return { nickname: u.nickname || '同学', avatar: u.avatar || '😀' }
  } catch (err) {
    return { nickname: '同学', avatar: '😀' }
  }
}

// 发一条站内通知（失败只记日志，不影响评价本身）
async function notify(toOpenid, text, orderId, from) {
  if (!toOpenid) return
  try {
    await db.collection('notices').add({
      data: {
        toOpenid,
        type: 'order',
        text,
        orderId,
        fromNickname: from.nickname,
        fromAvatar: from.avatar,
        read: false,
        createdAt: db.serverDate(),
      },
    })
  } catch (err) {
    console.warn('写通知失败', err.errCode, err.errMsg)
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const OPENID = wxContext.OPENID
  const action = event.action || 'create'

  if (action === 'create') return createReview(event, OPENID)
  if (action === 'ofOrder') return orderReviews(event, OPENID)
  if (action === 'list') return listReceived(event, OPENID)
  return { ok: false, msg: '未知的操作' }
}

async function createReview(event, OPENID) {
  const orderId = String(event.orderId || '').trim()
  const score = Number(event.score)
  const text = String(event.text || '').trim().slice(0, 200)

  if (!orderId) return { ok: false, msg: '缺少订单号' }
  if (!score || score < 1 || score > 5) return { ok: false, msg: '请先打星级（1-5 星）' }

  let order
  try {
    const res = await db.collection('orders').doc(orderId).get()
    order = res.data
  } catch (err) {
    return { ok: false, msg: '订单不存在或已删除' }
  }
  if (!order) return { ok: false, msg: '订单不存在或已删除' }
  if (order.status !== '已完成') return { ok: false, msg: '订单还没确认完成，先确认完成再评价' }

  const isOwner = order._openid === OPENID
  const isTaker = order.takerOpenid === OPENID
  if (!isOwner && !isTaker) return { ok: false, msg: '只有这单的双方能评价' }

  const toOpenid = isOwner ? order.takerOpenid : order._openid
  if (!toOpenid) return { ok: false, msg: '这单还没有人接，没法评价' }

  const existed = await db.collection('reviews').where({ orderId: orderId, fromOpenid: OPENID }).limit(1).get()
  if (existed.data && existed.data.length) return { ok: false, msg: '你已经评价过这单了' }

  const me = await myProfile(OPENID)
  const added = await db.collection('reviews').add({
    data: {
      orderId: orderId,
      fromOpenid: OPENID,
      toOpenid: toOpenid,
      score: score,
      text: text,
      createdAt: db.serverDate(),
      _openid: OPENID,
    },
  })

  await notify(toOpenid, '给了你一个订单评价：' + score + ' 星', orderId, me)
  return { ok: true, id: added._id, score: score }
}

async function orderReviews(event, OPENID) {
  const orderId = String(event.orderId || '').trim()
  if (!orderId) return { ok: false, msg: '缺少订单号' }

  let list = []
  try {
    const res = await db.collection('reviews').where({ orderId: orderId }).limit(10).get()
    list = (res.data || []).map(function (r) {
      return {
        id: r._id,
        fromOpenid: r.fromOpenid || '',
        score: Number(r.score || 0),
        text: r.text || '',
        mine: r.fromOpenid === OPENID,
        ts: toTs(r.createdAt),
      }
    })
  } catch (err) {
    // 集合还没建：当成没有评价
    console.warn('读评价失败（集合可能还没建）', err.errCode, err.errMsg)
    list = []
  }

  return {
    ok: true,
    count: list.length,
    myReview: list.filter(function (r) { return r.mine })[0] || null,
    theirReview: list.filter(function (r) { return !r.mine })[0] || null,
  }
}

async function listReceived(event, OPENID) {
  const target = String(event.openid || OPENID)
  let list = []
  try {
    const res = await db.collection('reviews').where({ toOpenid: target }).orderBy('createdAt', 'desc').limit(50).get()
    list = (res.data || []).map(function (r) {
      return { id: r._id, score: Number(r.score || 0), text: r.text || '', ts: toTs(r.createdAt) }
    })
  } catch (err) {
    list = []
  }
  const count = list.length
  const sum = list.reduce(function (acc, r) { return acc + r.score }, 0)
  return { ok: true, count: count, avg: count ? Number((sum / count).toFixed(1)) : 0, list: list }
}
