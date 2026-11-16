// pages/admin-posts/admin-posts.js —— 帖子管理（置顶 / 删除）

const api = require('../../utils/api.js')

Page({
  data: {
    loading: true,
    checked: false,
    isAdmin: false,
    keyword: '',
    list: [],
    total: 0,
    hasMore: false,
    loadingMore: false,
  },

  onReachBottom() {
    this.loadMore()
  },

  loadMore() {
    if (!this.data.hasMore || this.data.loadingMore || this.data.loading) return
    this.setData({ loadingMore: true })
    const next = Math.floor(this.data.list.length / 20) + 1
    api.adminPostsList(next, this.data.keyword)
      .then((res) => {
        this.setData({
          list: this.data.list.concat(res.list || []),
          total: res.total || 0,
          hasMore: res.hasMore === true,
          loadingMore: false,
        })
      })
      .catch(() => {
        this.setData({ loadingMore: false })
        wx.showToast({ title: '没加载出来，再上拉一次', icon: 'none' })
      })
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load(true)
  },

  load(fromPull) {
    const app = getApp()
    if (!fromPull) this.setData({ loading: true })

    const stop = () => {
      this.setData({ loading: false })
      if (fromPull) wx.stopPullDownRefresh()
    }

    return app.ready()
      .then(() => api.adminWhoAmI())
      .then((who) => {
        this.setData({ checked: true, isAdmin: who.admin })
        if (!who.admin) return null
        return api.adminPostsList(1, this.data.keyword).then((res) => {
          this.setData({ list: res.list || [], total: res.total || 0, hasMore: res.hasMore === true })
        })
      })
      .catch((err) => {
        wx.showToast({ title: (err && err.message) || '读取失败', icon: 'none' })
      })
      .then(stop)
  },

  onKeywordInput(e) {
    this._keyword = e.detail.value
  },

  doSearch() {
    this.setData({ keyword: (this._keyword || '').trim() })
    this.load()
  },

  clearSearch() {
    this._keyword = ''
    this.setData({ keyword: '' })
    this.load()
  },

  onTop(e) {
    const id = e.currentTarget.dataset.id
    const top = e.currentTarget.dataset.top
    if (!id) return
    wx.showLoading({ title: '处理中', mask: true })
    api.adminSetPostTop(id, !top)
      .then(() => {
        wx.hideLoading()
        wx.showToast({ title: top ? '已取消置顶' : '已置顶', icon: 'success' })
        getApp().globalData.postsDirty = true
        this.load()
      })
      .catch((err) => {
        wx.hideLoading()
        wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' })
      })
  },

  onDelete(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.showModal({
      title: '删除这条帖子？',
      content: '帖子、评论、点赞、图片都会一起删掉，不能恢复。',
      confirmText: '删除',
      confirmColor: '#e64340',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中', mask: true })
        api.adminRemovePost(id)
          .then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已删除', icon: 'success' })
            getApp().globalData.postsDirty = true
            this.load()
          })
          .catch((err) => {
            wx.hideLoading()
            wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' })
          })
      },
    })
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  },
})
