const crypto = require('crypto')
const { dayKeyCN } = require('./time')

const BACKUP_COLLECTIONS = [
  'posts', 'comments', 'orders', 'users', 'likes', 'favorites',
  'reports', 'notices', 'feedback', 'follows', 'reviews',
  'announcements', 'bans', 'settings', 'audit_logs', 'trash', 'wordfilters',
  'ads', 'admin_accounts', 'approvals',
]

const MAX_BYTES = 8 * 1024 * 1024
const DAY_MS = 24 * 60 * 60 * 1000

function isDailyTimer(event, source, openid) {
  return source === 'timer' && !openid && event && event.Type === 'Timer' &&
    event.TriggerName === 'campusDailyMaintenance'
}

// 使用扩展 JSON 保存数据库 Date；普通字符串（包括正文中的 ISO 日期）保持原类型。
function encodeDate(key, value) {
  const original = this[key]
  return original instanceof Date ? { $date: original.toISOString() } : value
}

function parseBackup(buffer) {
  const json = buffer.toString('utf8')
  const plain = JSON.parse(json)
  if (plain.formatVersion !== 2) return plain
  return JSON.parse(json, (key, value) => {
    if (value && typeof value.$date === 'string' && Object.keys(value).length === 1) {
      return new Date(value.$date)
    }
    return value
  })
}

async function snapshot(db, now) {
  const out = { formatVersion: 2 }
  let bytes = 0
  for (const name of BACKUP_COLLECTIONS) {
    const rows = []
    let lastId
    for (;;) {
      const collection = db.collection(name)
      const query = lastId === undefined ? collection : collection.where({ _id: db.command.gt(lastId) })
      const page = await query.orderBy('_id', 'asc').limit(100).get()
      for (const row of page.data) {
        bytes += Buffer.byteLength(JSON.stringify(row, encodeDate))
        if (bytes > MAX_BYTES) throw new Error('备份超过 8 MB 上限')
        rows.push(row)
      }
      if (page.data.length < 100) break
      lastId = rows[rows.length - 1]._id
    }
    out[name] = rows
  }
  out.exportedAt = new Date(now).toISOString()
  const buffer = Buffer.from(JSON.stringify(out, encodeDate))
  if (buffer.length > MAX_BYTES) throw new Error('备份超过 8 MB 上限')
  return buffer
}

// 路径不能由公开日期猜出。服务端私有 meta 集合里的随机密钥使同一天重试仍写同一对象。
async function dailyFileName(db, day) {
  const meta = db.collection('meta')
  const id = 'dailyBackupPathKey'
  const find = async () => (await meta.where({ _id: id }).limit(1).get()).data[0]
  let row = await find()
  if (!row) {
    const key = crypto.randomBytes(32).toString('hex')
    try {
      await meta.add({ data: { _id: id, key } })
      row = { key }
    } catch (err) {
      row = await find()
      if (!row) throw err
    }
  }
  return 'auto/' + crypto.createHmac('sha256', row.key).update(day).digest('hex')
}

async function saveBackup(db, cloud, day, now = Date.now()) {
  const backups = db.collection('backups')
  const id = day && 'daily-' + day
  if (id) {
    const existing = (await backups.where({ _id: id, source: 'auto' }).limit(1).get()).data[0]
    if (existing) return { id, size: existing.size }
  }
  // 同日重入共用文件路径和文档 ID；只有所有集合读取及上传完成，才登记可恢复备份。
  const fileContent = await snapshot(db, now)
  const filename = day ? await dailyFileName(db, day) : 'backup-' + crypto.randomBytes(12).toString('hex')
  const up = await cloud.uploadFile({ cloudPath: 'backups/' + filename + '.json', fileContent })
  if (!up.fileID) throw new Error('备份上传失败')
  const data = { fileID: up.fileID, size: fileContent.length, createdAt: db.serverDate(), source: day ? 'auto' : 'manual' }
  if (day) {
    await backups.doc(id).set({ data })
    return { id, size: data.size }
  }
  const row = await backups.add({ data })
  return { id: row._id, size: data.size }
}

async function pruneBackups(db, cloud) {
  const backups = db.collection('backups')
  let removed = 0
  for (;;) {
    // 自动备份的主键按北京时间日期排序；旧版手动备份没有 source 字段。
    const page = await backups.where({ source: 'auto' }).orderBy('_id', 'desc').skip(7).limit(50).get()
    if (!page.data.length) return removed
    for (const backup of page.data) {
      const result = await cloud.deleteFile({ fileList: [backup.fileID] })
      const file = (result.fileList || [])[0]
      if (!file || (file.status !== 0 && !/not\s*exist|not\s*found/i.test(file.errMsg || ''))) {
        throw new Error('过期备份文件删除失败，将在下次重试')
      }
      await backups.doc(backup._id).remove()
      removed++
    }
  }
}

async function removeExpired(query) {
  let count = 0
  for (;;) {
    const { stats } = await query.remove()
    if (!stats.removed) return count
    count += stats.removed
  }
}

async function runDaily(db, cloud, now = Date.now()) {
  const expired = await removeExpired(db.collection('admin_sessions').where({ expiresAt: db.command.lte(now) }))
  const backup = await saveBackup(db, cloud, dayKeyCN(now), now)
  const pruned = await pruneBackups(db, cloud)
  const trash = await removeExpired(db.collection('trash').where({ deletedAt: db.command.lte(new Date(now - 30 * DAY_MS)) }))
  return { ok: true, backupId: backup.id, backupsRemoved: pruned, trashRemoved: trash,
    sessionsRemoved: expired }
}

module.exports = { BACKUP_COLLECTIONS, parseBackup, saveBackup, isDailyTimer, runDaily }
