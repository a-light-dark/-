// 云函数：addComment —— 发评论（先做内容安全检测），同时给帖子的评论数 +1
// 为什么用云函数：评论人不是帖子作者，客户端没权限改帖子上的 commentCount。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 内容版本号 +1：小程序靠它判断「首页数据变了没」，没变就不用重拉
async function bumpContentVersion() {
  try {
    await db.collection('meta').doc('versions').update({
      data: { content: db.command.inc(1), updatedAt: db.serverDate() },
    })
  } catch (err) {
    try {
      await db.collection('meta').doc('versions').set({ data: { content: 1, ads: 0, config: 0, updatedAt: db.serverDate() } })
    } catch (e) {}
  }
}
const _ = db.command

// 订阅消息模板 ID：和 miniprogram/utils/subscribe.js 里的保持一致
// 在 mp.weixin.qq.com → 功能 → 订阅消息 里选模板后把 ID 填进来；留空就跳过推送
const TEMPLATE_IDS = {
  comment: '',
  like: '',
  order: '',
}
// 推送打开的小程序版本：开发版 developer / 体验版 trial / 正式版 formal
const MINIPROGRAM_STATE = 'developer'

function nowText() {
  const d = new Date(Date.now() + 8 * 3600 * 1000) // 云函数是 UTC，转成北京时间
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

async function checkText(content, scene, openid) {
  try {
    const res = await cloud.openapi.security.msgSecCheck({
      content: String(content || '').slice(0, 2500),
      version: 2,
      scene: scene,
      openid: openid,
    })
    const suggest = (res.result && res.result.suggest) || 'pass'
    return { ok: suggest === 'pass', suggest: suggest }
  } catch (err) {
    console.warn('msgSecCheck 调用失败（先放行）', err && err.errCode, err && err.errMsg)
    return { ok: true, apiError: true }
  }
}

// 敏感词库（圈主在管理台维护）：本地先拦一道
// 词库只有一份汇总文档：每次读 1 次即可（以前是扫 200 条），加词立刻生效
async function loadWords() {
  try {
    const r = await db.collection('wordlist').doc('main').get()
    const list = ((r.data && r.data.words) || []).filter(function (w) { return w && String(w.word || '').trim() })
    return list
  } catch (err) {
    try {
      const r2 = await db.collection('wordfilters').limit(200).get()
      const list = (r2.data || [])
        .map(function (w) { return { id: w._id, word: w.word } })
        .filter(function (w) { return w && String(w.word || '').trim() })
      return list
    } catch (e2) {
      return []
    }
  }
}

async function checkWords(content) {
  try {
    const list = await loadWords()
    if (!list.length) return { ok: true }
    const hit = list.find(function (w) { return content.indexOf(String(w.word).trim()) > -1 })
    if (hit) {
      // 命中次数给管理台看（失败不影响拦截）
      try {
        await db.collection('wordfilters').doc(hit.id).update({
          data: { hits: db.command.inc(1), lastHitAt: db.serverDate() },
        })
      } catch (err) {
        console.warn('记录敏感词命中失败', err && err.errCode)
      }
      return { ok: false, msg: '评论里有不合适的词，换一下再发' }
    }
    return { ok: true }
  } catch (err) {
    console.warn('读敏感词库失败（先放行）', err && err.errCode)
    return { ok: true }
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const postId = String(event.postId || '')
  const content = String(event.content || '').trim()
  if (!postId || !content) return { ok: false, msg: '参数不完整' }
  if (content.length > 300) return { ok: false, msg: '评论太长啦，300 字以内' }

  // 封禁检查：被圈主封禁的用户不能评论
  try {
    const me = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
    if (me.data && me.data[0] && me.data[0].banned) {
      return { ok: false, msg: '你的账号已被圈主限制，暂时不能评论' }
    }
  } catch (err) { /* 查不到就放行 */ }

  // 楼中楼：parentId 是「根评论」的 id（一层回复，不再往下嵌套）
  let rootId = ''
  let replyTo = ''
  const rawParentId = String(event.parentId || '')
  if (rawParentId) {
    const parentDoc = await db.collection('comments').doc(rawParentId).get().catch(function () { return null })
    const parent = parentDoc && parentDoc.data
    if (!parent) return { ok: false, msg: '这条评论不存在了' }
    if (String(parent.postId) !== postId) return { ok: false, msg: '评论和帖子对不上' }
    // 回复「回复」时，挂到同一个根评论下，并把被回复的人记下来
    rootId = parent.parentId ? String(parent.parentId) : String(parent._id || rawParentId)
    replyTo = String(event.replyTo || parent.nickname || '').slice(0, 20)
  }

  // 昵称头像优先用 users 里的最新资料，客户端传的只当兜底
  let nickname = event.nickname || '同学'
  let avatar = event.avatar || '😀'
  try {
    const user = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
    if (user.data && user.data[0]) {
      nickname = user.data[0].nickname || nickname
      avatar = user.data[0].avatar || avatar
    }
  } catch (err) {
    console.warn('读取用户资料失败', err && err.errMsg)
  }

  const check = await checkText(content, 2, OPENID) // scene 2 = 评论
  if (!check.ok) return { ok: false, msg: '评论可能不太合适，换个说法再试试', suggest: check.suggest }

  const wordCheck = await checkWords(content)
  if (!wordCheck.ok) return { ok: false, msg: wordCheck.msg }

  // 先看帖子作者 / 被回复的人是谁：评论成功要给他发一条消息通知
  const postDoc = await db.collection('posts').doc(postId).get().catch(function () { return null })
  const postOwner = postDoc && postDoc.data && postDoc.data._openid
  let replyOwner = ''
  let replyOwnerNick = ''
  if (rootId) {
    const rootDoc = await db.collection('comments').doc(rootId).get().catch(function () { return null })
    const root = rootDoc && rootDoc.data
    if (root) {
      replyOwner = root._openid || ''
      replyOwnerNick = root.nickname || ''
    }
  }

  const res = await db.collection('comments').add({
    data: {
      postId,
      content,
      nickname,
      avatar,
      parentId: rootId,
      replyTo: replyTo,
      createdAt: db.serverDate(),
      // 云函数写入不会自动带 _openid，手动补上，方便以后按作者查
      _openid: OPENID,
    },
  })

  await db.collection('posts').doc(postId).update({ data: { commentCount: _.inc(1) } })

  // 通知被回复的人（楼中楼）或帖子作者（顶层评论）；不通知自己
  const targetOpenid = replyOwner || (rootId ? '' : postOwner)
  if (targetOpenid && targetOpenid !== OPENID) {
    const noticeText = replyOwner
      ? '回复了你的评论：' + content.slice(0, 40)
      : '评论了你的帖子：' + content.slice(0, 40)
    try {
      await db.collection('notices').add({
        data: {
          toOpenid: targetOpenid,
          type: 'comment',
          postId: postId,
          commentId: rootId,
          fromNickname: nickname,
          fromAvatar: avatar,
          text: noticeText,
          read: false,
          createdAt: db.serverDate(),
        },
      })
    } catch (err) {
      console.warn('写评论通知失败（不影响评论）', err && err.errMsg)
    }

    // 顺带发一条订阅消息（用户在消息页授权过才会收到）
    await subscribeNotify(targetOpenid, 'comment', 'pages/detail/detail?id=' + postId, {
      thing1: { value: content.slice(0, 20) },
      thing2: { value: replyOwner ? nickname + ' 回复了 ' + replyOwnerNick : nickname + ' 评论了你的帖子' },
      time3: { value: nowText() },
    })
  }

  await bumpContentVersion()
  return { ok: true, id: res._id, nickname: nickname, avatar: avatar, parentId: rootId, replyTo: replyTo }
}
