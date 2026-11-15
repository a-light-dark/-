// 云函数：updatePost —— 编辑自己发过的帖子（正文 + 话题）
// 为什么必须走云函数：帖子集合对客户端是只读的，而且编辑后的文字也要过内容安全

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const posts = db.collection('posts')

const TOPIC_NAMES = [
  '日常投稿', '树洞', '表白墙', '新鲜事', '二手',
  '跑腿代取', '学习搭子', '失物招领', '脱单交友',
]

// 文字内容检测：接口异常时先放行（fail-open），避免编辑功能整体不可用
async function checkText(content, scene, openid) {
  try {
    const res = await cloud.openapi.security.msgSecCheck({
      content: String(content).slice(0, 2500),
      version: 2,
      scene: scene,
      openid: openid,
    })
    const suggest = res && res.result && res.result.suggest
    return { ok: suggest === 'pass', suggest: suggest || 'pass', apiError: false }
  } catch (err) {
    console.warn('msgSecCheck 调用失败（先放行）', err && err.errCode, err && err.errMsg)
    return { ok: true, suggest: 'unknown', apiError: true }
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const postId = String(event.postId || '').trim()
  const content = String(event.content || '').trim()
  const tags = Array.isArray(event.tags)
    ? event.tags.filter((t) => TOPIC_NAMES.indexOf(t) > -1).slice(0, 5)
    : []

  if (!postId) return { ok: false, msg: '帖子不存在' }
  if (!content) return { ok: false, msg: '正文不能为空' }
  if (content.length > 1000) return { ok: false, msg: '正文最多 1000 字' }

  let doc
  try {
    doc = await posts.doc(postId).get()
  } catch (err) {
    return { ok: false, msg: '帖子不存在或已经被删除了' }
  }
  const post = doc && doc.data
  if (!post) return { ok: false, msg: '帖子不存在或已经被删除了' }

  // 必须是作者本人。注意：不能用「post._openid 存在才校验」——老数据没有 _openid 时会被任何人编辑
  if (post._openid !== OPENID) {
    return { ok: false, msg: '只能编辑自己发的帖子' }
  }

  const check = await checkText(content, 3, OPENID)
  if (!check.ok) {
    return { ok: false, msg: '内容可能不太合适，换个说法再试试', suggest: check.suggest }
  }

  try {
    await posts.doc(postId).update({
      data: {
        content: content,
        tags: tags.length ? tags : (post.tags || []).slice(0, 5),
        updatedAt: db.serverDate(),
      },
    })
  } catch (err) {
    console.error('updatePost 写库失败', err)
    return { ok: false, msg: '保存失败，稍后再试' }
  }

  return { ok: true, id: postId, apiError: !!check.apiError }
}
