// 公开数据网关：给所有用户读「公告」「首页 banner 文案」「广告位」
// 说明：announcements / settings / ads 集合权限是「所有用户不可读写」，
// 普通用户读不到，所以统一由这个云函数代读（服务端有管理员权限）。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function ts(v) {
  if (!v) return 0
  const d = new Date(v)
  return isNaN(d.getTime()) ? Number(v) || 0 : d.getTime()
}

async function loadAds() {
  try {
    const res = await db.collection('ads').where({ enabled: true }).limit(20).get()
    const now = Date.now()
    return (res.data || [])
      .filter(function (a) {
        const start = ts(a.startAt)
        const end = ts(a.endAt)
        return (!start || start <= now) && (!end || end >= now)
      })
      .sort(function (a, b) { return Number(b.weight || 0) - Number(a.weight || 0) })
      .map(function (a) {
        return {
          id: a._id,
          title: a.title || '',
          image: a.image || '',
          position: a.position || 'home_banner',
          linkType: a.linkType || 'none',
          linkValue: a.linkValue || '',
        }
      })
  } catch (err) {
    return []
  }
}

async function adReport(event) {
  const id = String(event.id || '')
  const type = event.type === 'click' ? 'click' : 'view'
  if (!id) return { ok: false, msg: '缺少广告 id' }
  try {
    const data = type === 'click' ? { clicks: _.inc(1) } : { views: _.inc(1) }
    await db.collection('ads').doc(id).update({ data: data })
    return { ok: true }
  } catch (err) {
    return { ok: false, msg: '广告不存在' }
  }
}

exports.main = async (event) => {
  const action = String((event && event.action) || '')
  if (action === 'adReport') return adReport(event || {})

  const out = { ok: true, announcements: [], bannerText: '', ads: [] }
  // 圈主在运营配置里可以关掉公告展示（announcementEnabled = false）
  let enabled = true
  try {
    const s = await db.collection('settings').where({ key: 'announcementEnabled' }).limit(1).get()
    if (s.data && s.data[0] && (s.data[0].value === false || String(s.data[0].value).toLowerCase() === 'false')) enabled = false
  } catch (err) {
    // 集合还没建/读不到时默认开
  }
  if (enabled) {
    try {
      const ann = await db
        .collection('announcements')
        .where({ active: true })
        .orderBy('pinned', 'desc')
        .orderBy('createdAt', 'desc')
        .limit(5)
        .get()
      out.announcements = (ann.data || []).map(function (a) {
        return { id: a._id, title: a.title, content: a.content, pinned: a.pinned === true }
      })
    } catch (err) {
      // 集合还没建/读不到时给空列表，不挡首页
    }
  }
  try {
    const b = await db.collection('settings').where({ key: 'bannerText' }).limit(1).get()
    if (b.data && b.data[0]) out.bannerText = String(b.data[0].value || '')
  } catch (err) {
    // 同上
  }
  out.ads = await loadAds()
  return out
}
