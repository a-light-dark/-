const test = require('node:test')
const assert = require('node:assert/strict')
const { fixture } = require('./cloud-fixture')

function forum() {
  return fixture({
    posts: [{ _id: 'p', _openid: 'reader', commentCount: 2 }],
    comments: [
      { _id: 'c', postId: 'p', _openid: 'author', content: '被举报评论', parentId: '' },
      { _id: 'r', postId: 'p', _openid: 'reader', content: '应保留的回复', parentId: 'c' },
    ],
    reports: [{ _id: 'legacy', postId: 'p', _openid: 'reader', reason: '其他' }],
    admin_sessions: [{ _id: 's', token: 'local-admin', expiresAt: Date.now() + 86400000, role: 'admin' }],
  })
}

test('同一用户对同一评论的重复与并发举报只产生一条；同帖历史举报独立', async () => {
  const f = forum(), report = f.handler('reportPost')
  const input = { postId: 'p', commentId: 'c', reason: '其他' }
  const responses = await Promise.all([report(input), report(input)])
  assert.ok(responses.every(r => r.ok))
  assert.equal((await report(input)).duplicate, true)
  assert.equal(f.tables.reports.length, 2)
  assert.equal((await report({ ...input, commentId: 'r' })).ok, false)
  assert.equal((await report({ ...input, postId: 'different' })).ok, false)
})

test('新后台显示两类举报；旧后台仅返回帖子；删根评论保留原帖与回复', async () => {
  const f = forum()
  await f.handler('reportPost')({ postId: 'p', commentId: 'c', reason: '其他' })
  const admin = f.handler('adminApi')
  const invoke = (action, data = {}) => admin({ token: 'local-admin', action, ...data })
  const list = (await invoke('reports.list', { includeComments: true })).list
  assert.equal(list.length, 2)
  const comment = list.find(r => r.targetType === 'comment')
  assert.equal(comment.target.content, '被举报评论')
  assert.equal(comment.post, null)
  assert.equal((await invoke('reports.list')).list[0].id, 'legacy')
  assert.equal((await invoke('reports.list')).list.length, 1)
  assert.equal((await invoke('reports.removeComment', { id: 'legacy' })).ok, false)
  assert.equal((await invoke('reports.removeComment', { id: comment.id })).ok, true)
  assert.equal(f.tables.posts[0].commentCount, 1)
  assert.deepEqual(f.tables.comments.map(r => [r._id, r.parentId]), [['r', '']])
  assert.equal(f.tables.trash[0].data.content, '被举报评论')
  assert.deepEqual(f.tables.reports.map(r => r._id), ['legacy'])
  assert.equal(f.tables.notices.length, 1)
})

test('忽略评论举报不删除评论；目标已被作者删除时仍可忽略', async () => {
  const f = forum()
  const admin = f.handler('adminApi')
  for (const missing of [false, true]) {
    await f.handler('reportPost')({ postId: 'p', commentId: 'c', reason: '其他' })
    const report = f.tables.reports.find(r => r.commentId === 'c')
    if (missing) f.tables.comments.splice(0, 1)
    assert.equal((await admin({ action: 'reports.dismiss', id: report._id, token: 'local-admin' })).ok, true)
    assert.equal(f.tables.comments.length, missing ? 1 : 2)
  }
})

test('长按他人的楼中楼回复举报时提交回复 ID，本人评论只显示删除', async () => {
  const vm = require('node:vm')
  const fs = require('node:fs')
  const path = require('node:path')
  let page, sheet, sent
  const api = {
    REPORT_REASONS: ['其他'],
    async reportPost(...args) { sent = args; return { ok: true } },
  }
  const wx = { showActionSheet(options) { sheet = options }, showLoading() {}, hideLoading() {}, showToast() {} }
  const file = path.resolve(__dirname, '../miniprogram/pages/detail/detail.js')
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { Page(p) { page = p }, require: () => api, wx })
  page.data.post = { id: 'post' }
  const dataset = { id: 'reply', root: 'root', mine: false }
  page.onCommentLongPress({ currentTarget: { dataset } })
  assert.ok(sheet.itemList.includes('举报评论'))
  sheet.success({ tapIndex: sheet.itemList.indexOf('举报评论') })
  sheet.success({ tapIndex: 0 })
  assert.deepEqual(sent, ['post', '其他', 'reply'])
  page.onCommentLongPress({ currentTarget: { dataset: { ...dataset, mine: true } } })
  assert.ok(sheet.itemList.includes('删除') && !sheet.itemList.includes('举报评论'))
})
