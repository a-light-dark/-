const test = require('node:test')
const assert = require('node:assert/strict')
const { fixture } = require('./cloud-fixture')
const { runDaily, isDailyTimer, parseBackup } = require('../cloudfunctions/adminApi/lib/maintenance')

const day = 86400000
const now = Date.parse('2026-11-20T03:00:00+08:00')
function history() {
  const backups = Array.from({ length: 8 }, (_, i) => ({
    _id: 'daily-2026-11-' + (10 + i), source: 'auto', fileID: 'auto' + i,
  }))
  backups.push({ _id: 'old-manual', fileID: 'manual' }, { _id: 'manual', source: 'manual', fileID: 'manual2' })
  return fixture({
    backups, trash: [{ _id: 'old', deletedAt: new Date(now - 30 * day) },
      { _id: 'young', deletedAt: new Date(now - 30 * day + 1) }],
    admin_sessions: [{ _id: 'old', expiresAt: now }, { _id: 'valid', expiresAt: now + day }],
  })
}

test('只有平台定时调用可进入每日维护', () => {
  const event = { Type: 'Timer', TriggerName: 'campusDailyMaintenance' }
  assert.ok(isDailyTimer(event, 'timer', ''))
  assert.ok(!isDailyTimer(event, undefined, ''))
  assert.ok(!isDailyTimer(event, 'timer', 'user'))
  assert.ok(!isDailyTimer({ ...event, TriggerName: 'other' }, 'timer', ''))
})

test('只留七份成功的自动备份；30天及会话边界正确；同日重跑不增加备份', async () => {
  const f = history()
  const r = await runDaily(f.db, f.cloud, now)
  assert.deepEqual([r.backupsRemoved, r.trashRemoved, r.sessionsRemoved], [2, 1, 1])
  const record = f.tables.backups.find(row => row._id === r.backupId)
  assert.match(record.fileID, /^backups\/auto\/[0-9a-f]{64}\.json$/)
  const snapshot = parseBackup(f.files.get(record.fileID))
  assert.equal(snapshot.trash[0].deletedAt.getTime(), now - 30 * day)
  assert.equal(parseBackup(Buffer.from('{"posts":[]}')).posts.length, 0)
  assert.equal(snapshot.trash.length, 2)
  assert.equal(f.tables.trash[0]._id, 'young')
  assert.equal(f.tables.admin_sessions[0]._id, 'valid')
  const ids = f.tables.backups.map(b => b._id)
  assert.equal(ids.length, 9)
  assert.ok(ids.includes('manual') && ids.includes('old-manual'))
  assert.ok(!ids.includes('daily-2026-11-10') && !ids.includes('daily-2026-11-11'))
  await runDaily(f.db, f.cloud, now + 1000)
  assert.deepEqual(f.tables.backups.map(b => b._id), ids)
  assert.equal(f.files.size, 1)
})

test('上传失败、集合读取失败时保留旧备份和回收站', async () => {
  for (const failure of ['upload', 'read']) {
    const f = history()
    if (failure === 'upload') f.cloud.uploadFile = async () => { throw Error('upload') }
    else {
      const collection = f.db.collection
      f.db.collection = name => {
        if (name === 'reviews') throw Error('read')
        return collection(name)
      }
    }
    await assert.rejects(runDaily(f.db, f.cloud, now), new RegExp(failure))
    assert.equal(f.tables.backups.length, 10)
    assert.equal(f.tables.trash.length, 2)
  }
})

test('清理旧备份文件失败时保留记录，下次重跑补清', async () => {
  const f = history()
  const remove = f.cloud.deleteFile
  f.cloud.deleteFile = async () => ({ fileList: [{ status: -1, errMsg: 'network' }] })
  await assert.rejects(runDaily(f.db, f.cloud, now), /备份文件删除失败/)
  assert.equal(f.tables.backups.length, 11)
  f.cloud.deleteFile = remove
  await runDaily(f.db, f.cloud, now)
  assert.equal(f.tables.backups.length, 9)
  assert.equal(f.files.size, 1)
})

test('同日两个定时调用并行只占一条备份记录和一个存储对象', async () => {
  const f = fixture()
  await Promise.all([runDaily(f.db, f.cloud, now), runDaily(f.db, f.cloud, now)])
  assert.equal(f.tables.backups.length, 1)
  assert.equal(f.files.size, 1)
})
