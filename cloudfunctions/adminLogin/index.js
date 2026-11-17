// 云函数 adminLogin —— PC 端后台的账号密码登录
// 小程序端用 openid 白名单，网页端没有 openid，所以用「账号 + 密码」换一个 token，
// token 存进 admin_sessions（带角色），之后 adminApi 每次调用带上 token 即可。
// 密码只存 sha256 哈希，明文永远不落库。
// 账号表：admin_accounts { username, role, nickname, passwordHash, active, createdAt }
// 角色：owner 圈主 / developer 开发者 / admin 管理员 / operator 运营 / analyst 数据分析员

const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const LEGACY_KEY = 'adminPasswordHash'
const DEFAULT_PASSWORD = 'campus2026' // 第一次登录用这个密码，登录后请在网页里改掉
const SESSION_TTL = 7 * 24 * 3600 * 1000

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')

async function readLegacyHash() {
  try {
    const res = await db.collection('settings').where({ key: LEGACY_KEY }).limit(1).get()
    return (res.data && res.data[0] && res.data[0].value) || ''
  } catch (err) {
    return ''
  }
}

async function findAccount(username) {
  try {
    const res = await db.collection('admin_accounts').where({ username: String(username) }).limit(1).get()
    return (res.data || [])[0] || null
  } catch (err) {
    return null
  }
}

// 第一次用时引导出一个 owner 账号（兼容旧版把密码哈希存在 settings 的情况）
async function bootstrap() {
  let count = 0
  try {
    const c = await db.collection('admin_accounts').count()
    count = c.total || 0
  } catch (err) {
    return { ok: false, msg: '账号集合还没建（跑一次 setupCollections）' }
  }
  if (count > 0) return { ok: true }
  const legacy = await readLegacyHash()
  await db.collection('admin_accounts').add({
    data: {
      username: 'admin',
      role: 'owner',
      nickname: '圈主',
      passwordHash: legacy || sha256(DEFAULT_PASSWORD),
      active: true,
      createdAt: db.serverDate(),
    },
  })
  return { ok: true, created: true }
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
    return { ok: true, username: s.username, role: s.role || 'admin' }
  }

  if (action === 'changePassword') {
    const s = await findSession(event.token)
    if (!s) return { ok: false, msg: '登录过期了，重新登录一下' }
    const acc = await findAccount(s.username)
    if (!acc) return { ok: false, msg: '账号不存在' }
    const oldPwd = String(event.oldPassword || '')
    const newPwd = String(event.newPassword || '')
    if (newPwd.length < 6) return { ok: false, msg: '新密码至少 6 位' }
    if (sha256(oldPwd) !== acc.passwordHash) return { ok: false, msg: '旧密码不对' }
    await db.collection('admin_accounts').where({ username: s.username }).update({
      data: { passwordHash: sha256(newPwd), updatedAt: db.serverDate() },
    })
    // 兼容：如果这是 admin 账号，也把旧版 settings 里的哈希同步一下
    if (s.username === 'admin') {
      try {
        const res = await db.collection('settings').where({ key: LEGACY_KEY }).limit(1).get()
        if (res.data && res.data[0]) {
          await db.collection('settings').doc(res.data[0]._id).update({ data: { value: sha256(newPwd), updatedAt: db.serverDate() } })
        }
      } catch (err) {
        console.warn('同步旧密码哈希失败', err && err.message)
      }
    }
    return { ok: true }
  }

  // 默认动作：登录
  const boot = await bootstrap()
  if (!boot.ok) return boot

  const username = String(event.username || '').trim()
  const password = String(event.password || '')
  if (!username || !password) return { ok: false, msg: '请输入账号和密码' }

  const acc = await findAccount(username)
  if (!acc) return { ok: false, msg: '账号或密码不对' }
  if (acc.active === false) return { ok: false, msg: '这个账号已被停用，找圈主开一下' }
  if (sha256(password) !== acc.passwordHash) return { ok: false, msg: '账号或密码不对' }

  const token = crypto.randomBytes(24).toString('hex')
  await db.collection('admin_sessions').add({
    data: {
      token,
      username,
      role: acc.role || 'admin',
      createdAt: db.serverDate(),
      expiresAt: Date.now() + SESSION_TTL,
    },
  })

  return { ok: true, token, username, role: acc.role || 'admin', expiresIn: SESSION_TTL }
}
