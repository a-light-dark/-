// 每个云函数独立打包。同一写入口、同一微信用户共用一个固定窗口。
function remainingSeconds(start, now, windowMs) {
  return Math.max(0, Math.ceil((Number(start) + windowMs - now) / 1000))
}

async function checkRate(col, key, limit, windowMs, now = Date.now(), command) {
  try {
    const operations = command || require('wx-server-sdk').database().command
    // 同时首写或窗口切换时，重新读取胜出请求的记录；存储不可用时不放行。
    for (let attempt = 0; attempt < 3; attempt++) {
      const rows = await col.where({ _id: key }).limit(1).get()
      const current = rows.data[0]
      if (!current) {
        try {
          await col.add({ data: { _id: key, count: 1, windowStart: new Date(now) } })
          return { ok: true }
        } catch (err) {
          if (attempt === 2) throw err
          continue
        }
      }

      const seconds = remainingSeconds(current.windowStart, now, windowMs)
      const match = { _id: key, windowStart: current.windowStart }
      let changes
      if (seconds === 0) {
        changes = { count: 1, windowStart: new Date(now) }
      } else {
        if (current.count >= limit) {
          return { ok: false, msg: '操作太频繁了，先歇 ' + seconds + ' 秒再试' }
        }
        match.count = operations.lt(limit)
        changes = { count: operations.inc(1) }
      }
      const result = await col.where(match).update({ data: changes })
      if (result.stats.updated === 1) return { ok: true }
    }
  } catch (err) {
    console.warn('写入频率检查失败', err && err.errCode)
  }
  return { ok: false, msg: '暂时无法提交，请稍后再试' }
}

module.exports = { checkRate, remainingSeconds }
