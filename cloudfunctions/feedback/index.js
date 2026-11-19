// cloudfunctions/feedback/index.js —— 建议反馈：提交 / 我的反馈 / 管理员列表 / 标记已处理
const cloud = require('wx-server-sdk')
const { checkRate } = require('./lib/limit')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

// 管理员（圈主）白名单，和 adminReview 保持一致
const ADMIN_OPENIDS = ['oO3Q4xlLjdjHG-yb77GFRSkzTWsU']

function isAdmin(openid) {
  return ADMIN_OPENIDS.indexOf(openid) > -1
}

// 数据库里的 createdAt 是 Date，转成毫秒给客户端做「几分钟前」
function toTs(value) {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  const t = new Date(value).getTime()
  return isNaN(t) ? 0 : t
}

function mapRow(row) {
  return {
    id: row._id,
    content: row.content || '',
    contact: row.contact || '',
    nickname: row.nickname || '同学',
    avatar: row.avatar || '😀',
    status: row.status || '待处理',
    ts: toTs(row.createdAt),
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, msg: '没有拿到你的身份，请重进小程序' }

  const action = event.action || 'mine'

  // 1. 提交反馈
  if (action === 'create') {
    const content = String(event.content || '').trim()
    if (content.length < 5) return { ok: false, msg: '多写几个字吧（至少 5 个字）' }
    if (content.length > 500) return { ok: false, msg: '最多写 500 字，已经够说清楚了' }
    const contact = String(event.contact || '').trim().slice(0, 50)

    const rate = await checkRate(db.collection('rate_limits'), 'feedback_' + OPENID, 3, 60000)
    if (!rate.ok) return rate

    let me = null
    try {
      const users = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
      me = users.data[0] || null
    } catch (err) {
      console.warn('[feedback] 读用户资料失败', err.errCode, err.errMsg)
    }

    const add = await db.collection('feedback').add({
      data: {
        content: content,
        contact: contact,
        nickname: me ? me.nickname : '同学',
        avatar: me ? me.avatar : '😀',
        status: '待处理',
        createdAt: db.serverDate(),
        _openid: OPENID,
      },
    })
    return { ok: true, id: add._id }
  }

  // 2. 我提交过的反馈
  if (action === 'mine') {
    const res = await db.collection('feedback')
      .where({ _openid: OPENID })
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get()
    return { ok: true, list: res.data.map(mapRow) }
  }

  // 后面的操作只有管理员能做
  if (!isAdmin(OPENID)) return { ok: false, msg: '你没有管理权限' }

  // 3. 管理员看全部反馈
  if (action === 'list') {
    const res = await db.collection('feedback')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get()
    return { ok: true, list: res.data.map(mapRow) }
  }

  // 4. 管理员标记已处理
  if (action === 'resolve') {
    const id = String(event.id || '')
    if (!id) return { ok: false, msg: '缺少反馈 id' }
    const res = await db.collection('feedback').doc(id).update({
      data: { status: '已处理', resolvedAt: db.serverDate() },
    })
    const updated = (res.stats && res.stats.updated) || 0
    if (!updated) return { ok: false, msg: '这条反馈不存在或已经处理过了' }
    return { ok: true, updated: updated }
  }

  // 5. 管理员删除反馈（垃圾内容清理）
  if (action === 'remove') {
    const id = String(event.id || '')
    if (!id) return { ok: false, msg: '缺少反馈 id' }
    const res = await db.collection('feedback').doc(id).remove()
    const removed = (res.stats && res.stats.removed) || 0
    if (!removed) return { ok: false, msg: '这条反馈不存在' }
    return { ok: true, removed: removed }
  }

  return { ok: false, msg: '未知操作：' + action }
}
