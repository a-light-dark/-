// 云函数：grabOrder —— 悬赏订单全流程
// 状态机：待接单 →（接单人抢单）已接单 →（接单人标记完成）待确认 →（发布人确认）已完成
//        待接单 →（发布人撤销）已撤销
//        已接单 →（接单人取消接单）待接单
// 为什么用云函数：要改别人的订单；并且用「条件更新」保证两个人同时抢只有一个人成功。

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

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

// 发订阅消息（用户得先在小程序里授权过；没配模板、没授权都只是跳过）
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

// 给某人写一条通知（失败不影响主流程）
async function notify(toOpenid, text, orderId, fromNickname, fromAvatar) {
  if (!toOpenid) return
  try {
    await db.collection('notices').add({
      data: {
        toOpenid: toOpenid,
        type: 'order',
        orderId: orderId,
        fromNickname: fromNickname || '同学',
        fromAvatar: fromAvatar || '😀',
        text: text,
        read: false,
        createdAt: db.serverDate(),
      },
    })
  } catch (err) {
    console.warn('写订单通知失败（不影响主流程）', err && err.errMsg)
  }
}

// 当前用户资料（昵称头像一律服务端取）
async function myProfile(openid) {
  const user = await db.collection('users').where({ _openid: openid }).limit(1).get().catch(() => null)
  const me = (user && user.data && user.data[0]) || {}
  return { nickname: me.nickname || '同学', avatar: me.avatar || '😀' }
}

// 订单详情（订单详情页用）
async function getOrder(orderId) {
  const doc = await db.collection('orders').doc(orderId).get().catch(() => null)
  if (!doc || !doc.data) return { ok: false, msg: '订单不存在或已删除' }
  const d = doc.data
  const { OPENID } = cloud.getWXContext()

  // 顺带把发布人和接单人的昵称头像补齐（存的是发布时的快照，users 里可能已改名）
  const nickOf = {}
  const openids = [d._openid, d.takerOpenid].filter(Boolean)
  if (openids.length) {
    const users = await db.collection('users').where({ _openid: db.command.in(openids) }).limit(10).get().catch(() => null)
    ;(users && users.data || []).forEach((u) => { nickOf[u._openid] = { nickname: u.nickname, avatar: u.avatar } })
  }

  return {
    ok: true,
    order: {
      id: d._id,
      content: d.content || '',
      amount: Number(d.amount || 0).toFixed(2),
      status: d.status || '待接单',
      createdAt: d.createdAt,
      takenAt: d.takenAt || null,
      doneAt: d.doneAt || null,
      ownerNickname: (nickOf[d._openid] && nickOf[d._openid].nickname) || d.nickname || '同学',
      ownerAvatar: (nickOf[d._openid] && nickOf[d._openid].avatar) || d.avatar || '😀',
      takerNickname: d.takerOpenid
        ? ((nickOf[d.takerOpenid] && nickOf[d.takerOpenid].nickname) || d.takerName || '同学')
        : '',
      takerAvatar: d.takerOpenid
        ? ((nickOf[d.takerOpenid] && nickOf[d.takerOpenid].avatar) || '😀')
        : '',
      mine: d._openid === OPENID,
      takenByMe: !!d.takerOpenid && d.takerOpenid === OPENID,
    },
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = String(event.action || 'grab')
  const orderId = String(event.orderId || '')
  if (!orderId) return { ok: false, msg: '缺少订单 id' }

  if (action === 'get') {
    return getOrder(orderId)
  }

  // 封禁检查：被圈主封禁的用户不能抢单/标记完成/确认（get 查询不拦）
  try {
    const me = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
    if (me.data && me.data[0] && me.data[0].banned) {
      return { ok: false, msg: '你的账号已被圈主限制，暂时不能操作订单' }
    }
  } catch (err) { /* 查不到就放行 */ }

  const orders = db.collection('orders')
  const doc = await orders.doc(orderId).get().catch(() => null)
  if (!doc || !doc.data) return { ok: false, msg: '订单不存在或已删除' }
  const d = doc.data

  // ---------- 发布人：撤销（只能撤还没人接的单） ----------
  if (action === 'cancel') {
    if (d._openid !== OPENID) return { ok: false, msg: '只有发布人可以撤销订单' }
    const res = await orders
      .where({ _id: orderId, status: '待接单' })
      .update({ data: { status: '已撤销', cancelledAt: db.serverDate() } })
    if (!res.stats.updated) return { ok: false, msg: '订单已经有人接了，撤销不了' }
    return { ok: true, status: '已撤销' }
  }

  // ---------- 接单人：抢单 ----------
  if (action === 'grab') {
    if (d._openid === OPENID) return { ok: false, msg: '不能接自己发的单' }

    const me = await myProfile(OPENID)
    const res = await orders
      .where({ _id: orderId, status: '待接单' })
      .update({
        data: {
          status: '已接单',
          takerOpenid: OPENID,
          takerName: me.nickname,
          takenAt: db.serverDate(),
        },
      })
    if (!res.stats.updated) return { ok: false, msg: '手慢了，已经被别人接走' }

    await notify(d._openid, '接了你的悬赏：' + String(d.content || '').slice(0, 40), orderId, me.nickname, me.avatar)
    await subscribeNotify(d._openid, 'order', 'pages/order/order?id=' + orderId, {
      thing1: { value: String(d.content || '').slice(0, 20) },
      thing2: { value: me.nickname + ' 接了你的悬赏' },
      time3: { value: nowText() },
    })
    return { ok: true, status: '已接单' }
  }

  // ---------- 接单人：标记完成（进「待确认」，等发布人确认） ----------
  if (action === 'done') {
    if (d.takerOpenid !== OPENID) return { ok: false, msg: '只有接单人可以标记完成' }
    const me = await myProfile(OPENID)
    const res = await orders
      .where({ _id: orderId, takerOpenid: OPENID, status: '已接单' })
      .update({ data: { status: '待确认', doneAt: db.serverDate() } })
    if (!res.stats.updated) return { ok: false, msg: '当前状态不能标记完成' }

    await notify(d._openid, '接单人标记完成了，等你确认：' + String(d.content || '').slice(0, 40), orderId, me.nickname, me.avatar)
    await subscribeNotify(d._openid, 'order', 'pages/order/order?id=' + orderId, {
      thing1: { value: String(d.content || '').slice(0, 20) },
      thing2: { value: '标记完成了，等你确认' },
      time3: { value: nowText() },
    })
    return { ok: true, status: '待确认' }
  }

  // ---------- 发布人：确认完成（双向确认的最后一环，完成才计入收益） ----------
  if (action === 'confirm') {
    if (d._openid !== OPENID) return { ok: false, msg: '只有发布人可以确认完成' }
    const res = await orders
      .where({ _id: orderId, _openid: OPENID, status: '待确认' })
      .update({ data: { status: '已完成', confirmedAt: db.serverDate() } })
    if (!res.stats.updated) return { ok: false, msg: '当前状态不能确认完成' }

    await notify(d.takerOpenid, '你完成的悬赏已确认：' + String(d.content || '').slice(0, 40), orderId, d.nickname || '同学', d.avatar || '😀')
    await subscribeNotify(d.takerOpenid, 'order', 'pages/order/order?id=' + orderId, {
      thing1: { value: String(d.content || '').slice(0, 20) },
      thing2: { value: '发布人已确认完成，可以去评价' },
      time3: { value: nowText() },
    })
    return { ok: true, status: '已完成' }
  }

  // ---------- 接单人：取消接单（把单放回大厅） ----------
  if (action === 'release') {
    if (d.takerOpenid !== OPENID) return { ok: false, msg: '只有接单人可以取消接单' }
    const me = await myProfile(OPENID)
    const res = await orders
      .where({ _id: orderId, takerOpenid: OPENID, status: '已接单' })
      .update({ data: { status: '待接单', takerOpenid: '', takerName: '', takenAt: null, doneAt: null } })
    if (!res.stats.updated) return { ok: false, msg: '当前状态不能取消接单' }

    await notify(d._openid, '接单人取消了接单：' + String(d.content || '').slice(0, 40), orderId, me.nickname, me.avatar)
    return { ok: true, status: '待接单' }
  }

  return { ok: false, msg: '不认识的操作：' + action }
}
