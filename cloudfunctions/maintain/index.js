// 云函数：maintain —— 数据库小修小补（只在需要时手动调用）
// 现在能做两件事：
//   1) scan：抽样看各集合里时间字段的真实类型（Date / ISO 字符串 / 数字），
//      因为「字符串时间」会让范围查询（createdAt >= 今天）一条都命中不到；
//   2) migrate：把指定集合里「字符串形式的时间」批量转成 Date（默认 dryRun，只统计不写）。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COLLECTIONS = [
  'posts', 'comments', 'notices', 'orders', 'reports', 'feedback',
  'audit_logs', 'security_alerts', 'trash', 'backups', 'reviews',
  'users', 'follows', 'favorites', 'likes', 'bans',
]

function kindOf(v) {
  if (v === null || v === undefined) return 'null'
  if (v instanceof Date) return 'date'
  const t = Object.prototype.toString.call(v)
  if (t === '[object String]') return 'string'
  if (t === '[object Number]') return 'number'
  if (t === '[object Object]') return 'object'
  return t
}

async function scan() {
  const out = {}
  for (const name of COLLECTIONS) {
    try {
      const res = await db.collection(name).orderBy('createdAt', 'desc').limit(1).get()
      const doc = (res.data || [])[0] || null
      let total = 0
      try {
        const c = await db.collection(name).count()
        total = c.total || 0
      } catch (e) {}
      out[name] = {
        total: total,
        createdAt: doc ? kindOf(doc.createdAt) : 'no-doc',
        sample: doc && doc.createdAt ? String(doc.createdAt).slice(0, 30) : '',
      }
    } catch (err) {
      out[name] = { error: String((err && (err.errMsg || err.message)) || err).slice(0, 80) }
    }
  }
  return out
}

// 把字符串时间转 Date：只处理能被 Date 解析的字符串，其余原样跳过
async function migrate(name, field, dryRun) {
  const pageSize = 100
  let skip = 0
  let scanned = 0
  let converted = 0
  const bad = []
  for (;;) {
    let res
    try {
      res = await db.collection(name).orderBy('_id', 'asc').skip(skip).limit(pageSize).get()
    } catch (err) {
      return { ok: false, msg: '读集合失败：' + String(err && (err.errMsg || err.message)).slice(0, 80), scanned: scanned, converted: converted }
    }
    const rows = res.data || []
    if (!rows.length) break
    for (const row of rows) {
      scanned += 1
      const v = row[field]
      if (kindOf(v) !== 'string') continue
      const d = new Date(v)
      if (isNaN(d.getTime())) {
        if (bad.length < 5) bad.push({ id: row._id, value: String(v).slice(0, 30) })
        continue
      }
      if (!dryRun) {
        try {
          await db.collection(name).doc(row._id).update({ data: { [field]: d } })
        } catch (err) {
          if (bad.length < 5) bad.push({ id: row._id, error: String(err && err.errMsg).slice(0, 60) })
          continue
        }
      }
      converted += 1
    }
    if (rows.length < pageSize) break
    skip += pageSize
  }
  return { ok: true, collection: name, field: field, dryRun: dryRun !== false, scanned: scanned, converted: converted, bad: bad }
}

exports.main = async (event) => {
  const action = String((event && event.action) || 'scan')
  if (action === 'scan') {
    return { ok: true, action: 'scan', collections: await scan() }
  }
  // 验证范围查询是否恢复：分别数「最近 7 天」和「今天」有多少
  if (action === 'probeRange') {
    const now = Date.now()
    const week = new Date(now - 7 * 24 * 3600 * 1000)
    const today = new Date(new Date(now).setHours(0, 0, 0, 0))
    const _ = db.command
    const out = {}
    for (const name of ['posts', 'comments', 'notices', 'orders']) {
      try {
        const [w, t] = await Promise.all([
          db.collection(name).where({ createdAt: _.gte(week) }).count(),
          db.collection(name).where({ createdAt: _.gte(today) }).count(),
        ])
        out[name] = { week: w.total || 0, today: t.total || 0 }
      } catch (err) {
        out[name] = { error: String((err && (err.errMsg || err.message)) || err).slice(0, 80) }
      }
    }
    return { ok: true, action: 'probeRange', range: out }
  }
  if (action === 'migrate') {
    const names = Array.isArray(event.collections) && event.collections.length
      ? event.collections.filter(function (n) { return COLLECTIONS.indexOf(n) > -1 })
      : ['posts', 'comments']
    const field = String(event.field || 'createdAt')
    const dryRun = event.dryRun !== false
    const results = []
    for (const n of names) results.push(await migrate(n, field, dryRun))
    return { ok: true, action: 'migrate', dryRun: dryRun, field: field, results: results }
  }
  return { ok: false, msg: '未知 action：' + action }
}
