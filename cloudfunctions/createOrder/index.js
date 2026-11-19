// 云函数：createOrder —— 发布互助悬赏
// 内容安全检测 + 金额校验 + 服务端补昵称/头像，再写进 orders
const cloud = require('wx-server-sdk')
const { checkRate } = require('./lib/limit')
const { matchWord } = require('./lib/normalize')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 内容安全接口本身失败（没权限 / 超频 / 网络）时会先放行，这里记一条告警，
// 后台「安全告警」页能看到最近有哪些请求是被"放行"的。告警写失败不影响业务。
function logSecFail(kind, scene, err, extra) {
  try {
    const code = Number((err && (err.errCode || err.code)) || 0)
    const db2 = cloud.database()
    db2.collection('security_alerts').add({
      data: {
        kind: kind,
        scene: scene || '',
        code: code,
        message: String((err && (err.errMsg || err.message)) || ''),
        extra: String(extra || '').slice(0, 200),
        openid: (cloud.getWXContext() || {}).OPENID || '',
        createdAt: db2.serverDate(),
      },
    }).then(function () {}, function () {})
  } catch (e) {
    // 连告警都写不进去就算了，别影响主流程
  }
}

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
    logSecFail('text', 'order', err, content)
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
    const word = matchWord(content, list.map(w => w.word))
    const hit = word && list.find(w => w.word === word)
    if (hit) {
      // 命中次数给管理台看（失败不影响拦截）
      try {
        await db.collection('wordfilters').doc(hit.id).update({
          data: { hits: db.command.inc(1), lastHitAt: db.serverDate() },
        })
      } catch (err) {
        console.warn('记录敏感词命中失败', err && err.errCode)
      }
      return { ok: false, msg: '描述里有不合适的词，换一下再发' }
    }
    return { ok: true }
  } catch (err) {
    console.warn('读敏感词库失败（先放行）', err && err.errCode)
    return { ok: true }
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, msg: '没有拿到你的身份，请重进小程序' }
  const content = String(event.content || '').trim()
  const amount = Number(event.amount || 0)

  if (!content) return { ok: false, msg: '描述不能为空' }
  if (content.length > 200) return { ok: false, msg: '描述太长啦，200 字以内' }
  if (!amount || amount <= 0 || amount > 1000) return { ok: false, msg: '金额要在 0.01 - 1000 元之间' }

  // 封禁检查：被圈主封禁的用户不能发悬赏
  try {
    const me = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
    if (me.data && me.data[0] && me.data[0].banned) {
      return { ok: false, msg: '你的账号已被圈主限制，暂时不能发悬赏' }
    }
  } catch (err) { /* 查不到就放行 */ }

  const rate = await checkRate(db.collection('rate_limits'), 'order_' + OPENID, 3, 60000)
  if (!rate.ok) return rate

  let nickname = '同学' + String(OPENID).slice(-4)
  let avatar = '😀'
  try {
    const user = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
    if (user.data && user.data[0]) {
      nickname = user.data[0].nickname || nickname
      avatar = user.data[0].avatar || avatar
    }
  } catch (err) {
    console.warn('读取用户资料失败', err && err.errMsg)
  }

  const check = await checkText(content, 3, OPENID)
  if (!check.ok) return { ok: false, msg: '描述可能不太合适，换个说法再试试', suggest: check.suggest }

  const wordCheck = await checkWords(content)
  if (!wordCheck.ok) return { ok: false, msg: wordCheck.msg }

  const added = await db.collection('orders').add({
    data: {
      content: content,
      amount: Number(amount.toFixed(2)),
      status: '待接单',
      nickname: nickname,
      avatar: avatar,
      createdAt: db.serverDate(),
      _openid: OPENID,
    },
  })

  return { ok: true, id: added._id }
}
