// pages/admin/admin.js —— 举报处理（管理员页面）
// 只有 openid 在白名单里的圈主能进；判断在云函数 adminReview 里做，前端只负责显示。

const api = require('../../utils/api.js')

Page({
  data: {
    loading: true,     // 正在读数据
    checked: false,    // 是否已问过「是不是管理员」
    isAdmin: false,    // 是不是管理员
    reports: [],       // 举报列表
    total: 0,
    hasMore: false,
    page: 1,
    loadingMore: false,
  },

  // 上拉加载更多举报
  onReachBottom() {
    this.loadMore()
  },

  loadMore() {
    if (!this.data.hasMore || this.data.loadingMore || this.data.loading) return
    this.setData({ loadingMore: true })
    const next = Math.floor(this.data.reports.length / 20) + 1
    api.adminReportsList(next)
      .then((res) => {
        this.setData({
          reports: this.data.reports.concat(res.list || []),
          total: res.total || 0,
          hasMore: res.hasMore === true,
          page: next,
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
      .then(({ admin: isAdmin }) => {
        this.setData({ checked: true, isAdmin: isAdmin })
        if (!isAdmin) return []
        return api.adminReportsList(1).then((res) => this.setData({ reports: res.list || [], total: res.total || 0, hasMore: res.hasMore === true, page: 1 }))
      })
      .catch((err) => {
        console.error('读取举报失败', err)
        wx.showToast({ title: (err && err.message) || '读取失败', icon: 'none' })
      })
      .then(stop)
  },

  // 删除被举报的帖子（连同它的评论/点赞/收藏/举报一起清掉）
  onDeleteReport(e) {
    const postId = e.currentTarget.dataset.postid
    const reportId = e.currentTarget.dataset.id
    const row = this.data.reports.find(r => r.id === reportId)
    if (!row) return
    const comment = row.targetType === 'comment'
    const label = comment ? '评论' : '帖子'

    wx.showModal({
      title: '删除这条' + label + '？',
      content: comment ? '这条评论将移入回收站。原帖和其他回复会保留。' : '帖子将移入回收站。',
      confirmText: '删除',
      confirmColor: '#e64340',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中', mask: true })
        const removal = comment ? api.adminReportRemoveComment(reportId) : api.adminReportRemovePost(postId)
        removal
          .then((result) => {
            wx.hideLoading()
            wx.showToast({ title: result.pending ? '已提交审核' : '已删除', icon: 'success' })
            this.load()
            getApp().globalData.postsDirty = true
          })
          .catch((err) => {
            wx.hideLoading()
            wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' })
          })
      },
    })
  },

  // 忽略举报：只删举报记录，帖子保留
  onDismiss(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return

    wx.showModal({
      title: '忽略这条举报？',
      content: '被举报的内容会保留。',
      confirmText: '忽略',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '处理中', mask: true })
        api.adminDismissReport(id)
          .then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已忽略', icon: 'success' })
            this.setData({ reports: this.data.reports.filter((r) => r.id !== id) })
          })
          .catch((err) => {
            wx.hideLoading()
            wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' })
          })
      },
    })
  },

  // 去帖子详情看看原文
  goDetail(e) {
    const postId = e.currentTarget.dataset.postid
    if (!postId) return
    wx.navigateTo({ url: '/pages/detail/detail?id=' + postId })
  },
})
