const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

// 内存集合保留主键唯一性和条件更新语义，以便测试并发首写和窗口重置。
const command = { lt: value => ({ lt: value }), inc: value => ({ inc: value }) }
function collection() {
  const rows = new Map()
  return {
    async add({ data }) {
      if (rows.has(data._id)) throw new Error('duplicate key')
      rows.set(data._id, { ...data })
    },
    where(filter) {
      return {
        limit() { return this },
        async get() {
          const row = rows.get(filter._id)
          return { data: row ? [{ ...row }] : [] }
        },
        async update({ data }) {
          const row = rows.get(filter._id)
          if (!row || Number(row.windowStart) !== Number(filter.windowStart) ||
              (filter.count && row.count >= filter.count.lt)) {
            return { stats: { updated: 0 } }
          }
          if (data.windowStart) {
            assert.ok(data.windowStart instanceof Date)
            Object.assign(row, data)
          } else {
            row.count += data.count.inc
          }
          return { stats: { updated: 1 } }
        },
      }
    },
  }
}

for (const [name, max] of Object.entries({ createPost: 5, addComment: 10, createOrder: 3, reportPost: 5, feedback: 3 })) {
  const { checkRate } = require('../cloudfunctions/' + name + '/lib/limit')
  describe('limit.test.js · ' + name, () => {
    const start = Date.parse('2026-01-01T00:00:00Z')
    it('第 N 次允许，第 N+1 次拒绝，剩余时间向上取整', async () => {
      const col = collection()
      const write = (now, key = 'A') => checkRate(col, key, max, 60000, now, command)
      for (let i = 0; i < max; i++) assert.equal((await write(start)).ok, true)
      assert.deepEqual(await write(start + 59999), { ok: false, msg: '操作太频繁了，先歇 1 秒再试' })
      assert.equal((await write(start + 59999, 'B')).ok, true)
      assert.equal((await write(start + 60000)).ok, true)
    })
    it('并发首写与窗口切换各自最多放行 N 次', async () => {
      const col = collection()
      for (const now of [start, start + 61000]) {
        const results = await Promise.all(Array.from({ length: max + 3 },
          () => checkRate(col, 'A', max, 60000, now, command)))
        assert.equal(results.filter(r => r.ok).length, max)
        assert.ok(results.filter(r => !r.ok).every(r => r.msg.includes('太频繁')))
      }
    })
  })
}
