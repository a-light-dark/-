// 公开数据网关：给所有用户读「公告」和「首页 banner 文案」
// 说明：announcements / settings 集合权限是「所有用户不可读写」，
// 普通用户读不到，所以统一由这个云函数代读（服务端有管理员权限）。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async () => {
  const out = { ok: true, announcements: [], bannerText: '' }
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
  try {
    const s = await db.collection('settings').where({ key: 'bannerText' }).limit(1).get()
    if (s.data && s.data[0]) out.bannerText = String(s.data[0].value || '')
  } catch (err) {
    // 同上
  }
  return out
}
