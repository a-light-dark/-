// pages/my-posts/my-posts.js —— 我的帖子 / 历史评论
const api = require('../../utils/api.js')

Page({
  data: {
    tab: 'posts',
    posts: [],
    comments: [],
    loading: true,
    offline: false,
  },

  onLoad(options) {
    if (options && options.tab === 'comments') {
      this.setData({ tab: 'comments' })
    }
  },

  onShow() {
    this.load()
  },

  load() {
    this.setData({ loading: true })
    const app = getApp()
    app.ready()
      .then(() => Promise.all([api.fetchMyPosts(), api.fetchMyComments()]))
      .then((res) => {
        this.setData({
          posts: res[0] || [],
          comments: res[1] || [],
          loading: false,
          offline: !api.isCloudReady(),
        })
      })
      .catch((err) => {
        console.error('读取我的内容失败', err)
        this.setData({ loading: false })
        wx.showToast({ title: '读取失败，下拉再试', icon: 'none' })
      })
  },

  onPullDownRefresh() {
    this.load()
    setTimeout(() => wx.stopPullDownRefresh(), 600)
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab && tab !== this.data.tab) this.setData({ tab })
  },

  goPostDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  },

  goCommentPost(e) {
    const index = Number(e.currentTarget.dataset.index)
    const item = this.data.comments[index]
    if (!item) return
    if (!item.postExists) {
      wx.showToast({ title: '原帖已经被删除了', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/detail/detail?id=' + item.postId })
  },
})
