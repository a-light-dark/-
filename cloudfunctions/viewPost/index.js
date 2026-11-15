// 云函数：viewPost —— 帖子浏览量 +1
// 为什么用云函数：读的人不是作者，客户端没权限改别人帖子上的字段。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const postId = String(event.postId || '')
  if (!postId) return { ok: false, msg: '缺少帖子 id' }

  try {
    await db.collection('posts').doc(postId).update({ data: { views: _.inc(1) } })
  } catch (err) {
    // 帖子被删了、或者没有 views 字段都不会影响阅读，安静失败即可
    return { ok: false, msg: '浏览数没加上', errCode: err && err.errCode }
  }

  try {
    const res = await db.collection('posts').doc(postId).get()
    return { ok: true, views: (res.data && res.data.views) || 1 }
  } catch (err) {
    return { ok: true, views: null }
  }
}
