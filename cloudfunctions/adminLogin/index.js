// 云函数 adminLogin —— PC 端后台的账号密码登录
// 小程序端用 openid 白名单，网页端没有 openid，所以用「账号 + 密码」换一个 token，
// token 存进 admin_sessions，之后 adminApi 每次调用带上 token 即可。
// 密码只存 sha256 哈希，明文永远不落库。

const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const SETTING_KEY = 'adminPasswordHash'
const DEFAULT_PASSWORD = 'campus2026' // 第一次登录用这个密码，登录后请在网页里改掉
const SESSION_TTL = 7 * 24 * 3600 * 1000

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')

async function readHash() {
  try {
    const res = await db.collection('settings').where({ key: SETTING_KEY }).limit(1).get()
    return (res.data && res.data[0] && res.data[0].value) || ''
  } catch (err) {
    return ''
  }
}

async function writeHash(hash) {
  const res = await db.collection('settings').where({ key: SETTING_KEY }).limit(1).get()
  if (res.data && res.data[0]) {
    await db.collection('settings').doc(res.data[0]._id).update({ data: { value: hash, updatedAt: db.serverDate() } })
  } else {
    await db.collection('settings').add({ data: { key: SETTING_KEY, value: hash, updatedAt: db.serverDate() } })
  }
}

async function findSession(token) {
  if (!token) return null
  const res = await db.collection('admin_sessions').where({ token: String(token) }).limit(1).get()
  const s = (res.data || [])[0]
  if (!s) return null
  if (Number(s.expiresAt || 0) < Date.now()) return null
  return s
}

exports.main = async (event) => {
  const action = String(event.action || 'login')

  if (action === 'logout') {
    const token = String(event.token || '')
    if (token) {
      try {
        await db.collection('admin_sessions').where({ token }).remove()
      } catch (err) {
        console.warn('退出时删 session 失败', err && err.message)
      }
    }
    return { ok: true }
  }

  if (action === 'whoami') {
    const s = await findSession(event.token)
    if (!s) return { ok: false, msg: '登录过期了，重新登录一下' }
    return { ok: true, username: s.username }
  }

  if (action === 'changePassword') {
    const s = await findSession(event.token)
    if (!s) return { ok: false, msg: '登录过期了，重新登录一下' }
    const oldPwd = String(event.oldPassword || '')
    const newPwd = String(event.newPassword || '')
    if (newPwd.length < 6) return { ok: false, msg: '新密码至少 6 位' }
    let hash = await readHash()
    if (!hash) hash = sha256(DEFAULT_PASSWORD)
    if (sha256(oldPwd) !== hash) return { ok: false, msg: '旧密码不对' }
    await writeHash(sha256(newPwd))
    return { ok: true }
  }

  // 默认动作：登录
  const username = String(event.username || '').trim()
  const password = String(event.password || '')
  if (username !== 'admin') return { ok: false, msg: '账号或密码不对' }
  if (!password) return { ok: false, msg: '请输入密码' }

  let hash = await readHash()
  if (!hash) {
    // 第一次登录：用默认密码引导，登录成功后把哈希写进去
    if (password !== DEFAULT_PASSWORD) {
      return { ok: false, msg: '第一次登录请用默认密码 campus2026' }
    }
    hash = sha256(DEFAULT_PASSWORD)
    await writeHash(hash)
  }
  if (sha256(password) !== hash) return { ok: false, msg: '账号或密码不对' }

  const token = crypto.randomBytes(24).toString('hex')
  await db.collection('admin_sessions').add({
    data: { token, username, createdAt: db.serverDate(), expiresAt: Date.now() + SESSION_TTL },
  })

  return { ok: true, token, username, expiresIn: SESSION_TTL }
}
