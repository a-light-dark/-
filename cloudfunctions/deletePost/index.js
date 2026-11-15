// 云函数：deletePost —— 删自己的帖子
// 为什么用云函数：删除要连带清掉评论/点赞/收藏，客户端没有这个权限。
// 而且用「条件删除」保证只能删 _openid 是自己的帖子。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 删云存储里的图片（失败只记日志，不影响删帖结果）
async function removeFiles(fileIDs) {
  const list = (fileIDs || [])
    .map(function (id) { return String(id || '') })
    .filter(function (id) { return id.indexOf('cloud://') === 0 })
  if (!list.length) return 0
  try {
    const res = await cloud.deleteFile({ fileList: list })
    return (res.fileList || []).length
  } catch (err) {
    console.warn('删除帖子图片失败', err && err.errCode, err && err.errMsg)
    return 0
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const postId = String(event.postId || '')
  if (!postId) return { ok: false, msg: '缺少帖子 id' }

  // 先读出图片列表：删完数据库记录就查不到了
  let images = []
  try {
    const doc = await db.collection('posts').doc(postId).get()
    if (doc && doc.data) {
      images = (doc.data.images || []).slice(0, 9)
      // 不是自己的帖子，deletePost 只应该删自己的
      if (doc.data._openid && doc.data._openid !== OPENID) {
        return { ok: false, msg: '只能删自己发的帖子' }
      }
    }
  } catch (err) {
    // 帖子不存在：后面的条件删除也会返回 removed=0
    console.warn('读取帖子失败', err && err.errCode, err && err.errMsg)
  }

  // 条件删除：不是自己的帖子，removed 会是 0
  const res = await db.collection('posts').where({ _id: postId, _openid: OPENID }).remove()
  if (!res.stats.removed) return { ok: false, msg: '只能删自己发的帖子' }

  // 连带清掉这条帖子下面的评论、点赞（清不掉也不影响删帖本身）
  // 收藏记录故意不删：别人收藏里会显示「帖子已被删除」，由本人决定要不要清掉
  await Promise.all([
    db.collection('comments').where({ postId }).remove().catch(function () { return null }),
    db.collection('likes').where({ postId }).remove().catch(function () { return null }),
  ])

  // 最后删云存储里的图，避免存储里堆没人引用的文件
  const fileCount = await removeFiles(images)

  return { ok: true, filesRemoved: fileCount }
}
