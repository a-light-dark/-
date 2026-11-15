// utils/format.js —— 把时间变成「刚刚 / 3分钟前 / 昨天」这种好读的写法

function pad2(n) {
  return n < 10 ? '0' + n : String(n)
}

// 输入 Date、时间戳或日期字符串，输出相对时间
function relativeTime(value) {
  if (!value) return ''
  const ts = value instanceof Date ? value.getTime() : new Date(value).getTime()
  if (!ts || isNaN(ts)) return ''

  const now = Date.now()
  const diff = Math.max(0, now - ts)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return '刚刚'
  if (diff < hour) return Math.floor(diff / minute) + '分钟前'
  if (diff < day) return Math.floor(diff / hour) + '小时前'
  if (diff < 2 * day) return '昨天'
  if (diff < 7 * day) return Math.floor(diff / day) + '天前'

  const d = new Date(ts)
  return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

module.exports = { relativeTime }
