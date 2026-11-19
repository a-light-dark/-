const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { SHANGHAI_OFFSET, dayKeyCN, dayStartCN, seriesDays } = require('../cloudfunctions/adminApi/lib/time')

describe('time.test.js · 北京时间', () => {
  for (const time of ['00:30', '07:59', '08:00', '23:59']) {
    it(time + ' 属于同一天', () => {
      const ts = Date.parse('2026-01-01T' + time + ':00+08:00')
      assert.equal(dayKeyCN(ts), '2026-01-01')
      assert.equal(dayStartCN(ts), Date.parse('2025-12-31T16:00:00Z'))
    })
  }

  it('午夜前后按 UTC+8 切换日期', () => {
    assert.equal(SHANGHAI_OFFSET, 8 * 3600 * 1000)
    const midnight = Date.parse('2024-02-29T16:00:00Z')
    assert.equal(dayKeyCN(midnight - 1), '2024-02-29')
    assert.equal(dayKeyCN(midnight), '2024-03-01')
    assert.equal(dayStartCN(midnight), midnight)
  })

  it('七个连续半开区间横跨年末', () => {
    const days = seriesDays(Date.parse('2026-01-03T02:00:00+08:00'), 7)
    assert.deepEqual(days.map(d => d.key), [
      '2025-12-28', '2025-12-29', '2025-12-30', '2025-12-31',
      '2026-01-01', '2026-01-02', '2026-01-03',
    ])
    days.forEach((day, i) => {
      assert.equal(day.to - day.from, 86400000)
      assert.equal(dayKeyCN(day.from), day.key)
      assert.equal(dayKeyCN(day.to - 1), day.key)
      if (i) assert.equal(day.from, days[i - 1].to)
    })
  })
})
