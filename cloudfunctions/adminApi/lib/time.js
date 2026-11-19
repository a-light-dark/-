const DAY_MS = 24 * 3600 * 1000
const SHANGHAI_OFFSET = 8 * 3600 * 1000

function dayStartCN(ts) {
  return Math.floor((Number(ts) + SHANGHAI_OFFSET) / DAY_MS) * DAY_MS - SHANGHAI_OFFSET
}

function dayKeyCN(ts) {
  return new Date(Number(ts) + SHANGHAI_OFFSET).toISOString().slice(0, 10)
}

function seriesDays(endTs, days) {
  const first = dayStartCN(endTs) - (days - 1) * DAY_MS
  return Array.from({ length: days }, (_, i) => {
    const from = first + i * DAY_MS
    return { key: dayKeyCN(from), from, to: from + DAY_MS }
  })
}

module.exports = { SHANGHAI_OFFSET, dayStartCN, dayKeyCN, seriesDays }
