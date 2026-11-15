// pages/search/search.js —— 搜索：帖子内容 / 话题 / 昵称
const api = require('../../utils/api.js')

const HOT_WORDS = ['图书馆', '食堂', '考试周', '社团', '失物招领', '二手', '跑腿', '脱单']
const HISTORY_KEY = 'searchHistory'
const HISTORY_MAX = 10

Page({
  data: {
    keyword: '',
    hotWords: HOT_WORDS,
    history: [],
    results: [],
    searched: false,
    loading: false,
  },

  onLoad() {
    this.setData({ history: wx.getStorageSync(HISTORY_KEY) || [] })
  },

  onInput(e) {
    const keyword = e.detail.value || ''
    this.setData({ keyword: keyword })
    if (!keyword) this.setData({ results: [], searched: false })
  },

  onConfirm() {
    this.doSearch(this.data.keyword)
  },

  onHotTap(e) {
    this.doSearch(e.currentTarget.dataset.word)
  },

  onHistoryTap(e) {
    this.doSearch(e.currentTarget.dataset.word)
  },

  clearKeyword() {
    this.setData({ keyword: '', results: [], searched: false })
  },

  clearHistory() {
    wx.removeStorageSync(HISTORY_KEY)
    this.setData({ history: [] })
  },

  doSearch(word) {
    const kw = String(word || '').trim()
    if (!kw) {
      wx.showToast({ title: '输入点关键词再搜', icon: 'none' })
      return
    }
    this.setData({ keyword: kw, loading: true })
    this.saveHistory(kw)
    api.searchPosts(kw)
      .then((list) => {
        this.setData({ results: list, searched: true, loading: false })
      })
      .catch((err) => {
        console.error('搜索失败', err)
        this.setData({ searched: true, loading: false })
        wx.showToast({ title: '搜索失败，稍后再试', icon: 'none' })
      })
  },

  // 搜索历史：最近 10 条，重复的挪到最前面
  saveHistory(word) {
    const oldList = wx.getStorageSync(HISTORY_KEY) || []
    const next = [word].concat(oldList.filter((w) => w !== word)).slice(0, HISTORY_MAX)
    wx.setStorageSync(HISTORY_KEY, next)
    this.setData({ history: next })
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  },

  // 点搜索结果里的头像/昵称：进他的个人主页
  goUser(e) {
    const openid = e.currentTarget.dataset.openid
    if (e.currentTarget.dataset.anon) { wx.showToast({ title: '匿名帖不显示作者主页', icon: 'none' }); return }
    if (!openid) return
    wx.navigateTo({ url: '/pages/user/user?openid=' + encodeURIComponent(openid) })
  },

  previewPostImage(e) {
    const pid = e.currentTarget.dataset.pid
    const src = e.currentTarget.dataset.src
    const post = this.data.results.filter((p) => String(p.id) === String(pid))[0]
    if (!post || !post.images || !post.images.length) return
    wx.previewImage({ current: src, urls: post.images })
  },
})
