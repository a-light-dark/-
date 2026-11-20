const { createRequire } = require('node:module')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// 只实现这两条业务链用到的数据库操作。所有数据仅存在当前测试内存中。
function fixture(seed = {}) {
  const tables = structuredClone(seed)
  const files = new Map()
  let seq = 0
  const ops = {
    neq: v => x => x !== v, in: values => x => values.includes(x),
    gt: v => x => x > v, lt: v => x => x < v, lte: v => x => x <= v,
    inc: step => old => (old || 0) + step,
  }
  function query(name, filter = {}) {
    const rows = tables[name] || (tables[name] = [])
    const matches = row => Object.entries(filter).every(([key, v]) =>
      typeof v === 'function' ? v(row[key]) : v instanceof Date ? +v === +row[key] : row[key] === v)
    let skip = 0, limit = 100, sort = null
    return {
      where: q => query(name, q),
      doc: id => query(name, { _id: id }),
      orderBy(key, dir) { sort = (a, b) => String(a[key]).localeCompare(String(b[key])) * (dir === 'desc' ? -1 : 1); return this },
      skip(n) { skip = n; return this },
      limit(n) { limit = n; return this },
      async get() {
        const list = rows.filter(matches)
        if (sort) list.sort(sort)
        const data = list.slice(skip, skip + limit)
        return { data: this.single ? data[0] : data }
      },
      async count() { return { total: rows.filter(matches).length } },
      async add({ data }) {
        const id = data._id || 'new-' + (++seq)
        if (rows.some(row => row._id === id)) throw new Error('duplicate')
        rows.push({ ...data, _id: id })
        return { _id: id }
      },
      async set({ data }) {
        const index = rows.findIndex(matches)
        const row = { ...data, _id: filter._id }
        if (index < 0) rows.push(row)
        else rows[index] = row
      },
      async update({ data }) {
        const list = rows.filter(matches)
        for (const row of list) for (const [key, v] of Object.entries(data)) {
          row[key] = typeof v === 'function' ? v(row[key]) : v
        }
        return { stats: { updated: list.length } }
      },
      async remove() {
        const kept = rows.filter(row => !matches(row))
        const removed = rows.length - kept.length
        rows.splice(0, rows.length, ...kept)
        return { stats: { removed } }
      },
    }
  }
  const db = {
    command: ops, serverDate: () => new Date(), runTransaction: fn => fn(db),
    collection(name) {
      const q = query(name)
      q.doc = id => Object.assign(query(name, { _id: id }), { single: true })
      return q
    },
  }
  const cloud = {
    init() {}, database: () => db, getWXContext: () => ({ OPENID: 'reader' }),
    async uploadFile({ cloudPath, fileContent }) { files.set(cloudPath, fileContent); return { fileID: cloudPath } },
    async deleteFile({ fileList }) { fileList.forEach(id => files.delete(id)); return { fileList: fileList.map(() => ({ status: 0 })) } },
  }
  function handler(name) {
    const file = path.resolve(__dirname, '../cloudfunctions', name, 'index.js')
    const local = createRequire(file)
    const sandbox = { exports: {}, console, Date, process: { env: {} }, require(id) {
      if (id === 'wx-server-sdk') return cloud
      if (id === './lib/limit') return {
        checkRate: (...args) => local(id).checkRate(...args, Date.now(), ops),
      }
      return local(id)
    } }
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file })
    return sandbox.exports.main
  }
  return { db, cloud, tables, files, handler }
}

module.exports = { fixture }
