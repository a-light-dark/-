// pages/detail/detail.js —— 帖子详情：点赞 / 收藏 / 评论（数据来自云数据库）

const api = require('../../utils/api.js')

Page({
  data: {
    post: null,
    comments: [],
    inputValue: '',
    collected: false, // 是否已收藏（暂时只在本机记状态）
    liked: false,     // 我有没有点过赞
    loading: true,
  },

  onLoad(options) {
    this.postId = String(options.id || '')
    this.loadAll()
  },

  loadAll() {
    this.setData({ loading: true })
    Promise.all([
      api.fetchPost(this.postId),
      api.fetchComments(this.postId),
    ])
      .then((res) => {
        const detail = res[0]
        this.setData({
          post: detail.post,
          liked: !!detail.liked,
          favorited: !!detail.favorited,
          comments: res[1] || [],
          loading: false,
        })
      })
      .catch((err) => {
        console.error('打开帖子失败', err)
        this.setData({ loading: false })
        wx.showToast({ title: '加载失败，看控制台', icon: 'none' })
      })
  },

  // 点赞 / 取消点赞（云端由 likePost 云函数处理）
  toggleLike() {
    if (!this.data.post || this._liking) return
    this._liking = true
    api.toggleLike(this.postId)
      .then((res) => {
        this.setData({
          post: Object.assign({}, this.data.post, { likeCount: res.likeCount }),
          liked: !!res.liked,
        })
      })
      .catch((err) => {
        console.error('点赞失败', err)
        wx.showToast({ title: '操作失败', icon: 'none' })
      })
      .then(() => { this._liking = false })
  },

  // 收藏（写进 favorites 集合，重启后还在）
  toggleCollect() {
    if (this._collecting) return
    this._collecting = true
    const next = !this.data.favorited
    api.toggleFavorite(this.postId)
      .then((res) => {
        this.setData({ favorited: !!res.favorited })
        wx.showToast({ title: res.favorited ? '已收藏' : '已取消收藏', icon: 'none' })
      })
      .catch((err) => {
        console.error('收藏失败', err)
        wx.showToast({ title: '操作失败，再试一次', icon: 'none' })
        this.setData({ favorited: !next })
      })
      .then(() => { this._collecting = false })
  },

  // ===== 自己的帖子：删除 =====
  onDelete() {
    const post = this.data.post
    if (!post) return
    wx.showModal({
      title: '删除这条帖子？',
      content: '删除后这条帖子、它的评论和点赞都会一起消失，无法恢复。',
      confirmText: '删除',
      confirmColor: '#e64340',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中', mask: true })
        api.deletePost(post.id)
          .then(() => {
            wx.hideLoading()
            // 告诉首页「列表变了」，回去刷新
            const app = getApp()
            if (app && app.globalData) app.globalData.postsDirty = true
            wx.showToast({ title: '已删除', icon: 'success' })
            setTimeout(() => wx.navigateBack(), 600)
          })
          .catch((err) => {
            wx.hideLoading()
            wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' })
          })
      },
    })
  },

  // ===== 别人的帖子：举报 =====
  onReport() {
    const post = this.data.post
    if (!post) return
    wx.showActionSheet({
      itemList: api.REPORT_REASONS,
      success: (res) => {
        const reason = api.REPORT_REASONS[res.tapIndex]
        wx.showLoading({ title: '提交中', mask: true })
        api.reportPost(post.id, reason)
          .then((r) => {
            wx.hideLoading()
            wx.showToast({ title: r.duplicate ? '你已经举报过啦' : '已收到举报，谢谢你', icon: 'none' })
          })
          .catch((err) => {
            wx.hideLoading()
            wx.showToast({ title: (err && err.message) || '举报失败', icon: 'none' })
          })
      },
    })
  },

  onInput(e) {
    this.setData({ inputValue: e.detail.value })
  },

  // 右上角「…」→ 转发给同学 / 群：带帖子内容和第一张图
  onShareAppMessage() {
    const post = this.data.post || {}
    const content = String(post.content || '').replace(/\s+/g, ' ').trim()
    return {
      title: content ? content.slice(0, 30) : '校园圈 · 看看这条帖子',
      path: '/pages/detail/detail?id=' + this.postId,
      imageUrl: post.images && post.images.length ? post.images[0] : '',
    }
  },

  // 点图片放大看
  previewImage(e) {
    const src = e.currentTarget.dataset.src
    const images = (this.data.post && this.data.post.images) || []
    if (!images.length) return
    wx.previewImage({ current: src, urls: images })
  },

  // 点话题标签进话题页
  goTopic(e) {
    const tag = e.currentTarget.dataset.tag
    if (!tag) return
    wx.navigateTo({ url: '/pages/topic/topic?tag=' + encodeURIComponent(tag) })
  },

  // 点作者头像/昵称：进个人主页
  goUser(e) {
    const openid = e.currentTarget.dataset.openid
    if (!openid) {
      wx.showToast({ title: '演示数据没有主页', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/user/user?openid=' + encodeURIComponent(openid) })
  },

  // 发评论：写进 comments 集合，同时给帖子评论数 +1
  sendComment() {
    const text = this.data.inputValue.trim()
    if (!text) {
      wx.showToast({ title: '说点什么吧', icon: 'none' })
      return
    }
    if (this._sending) return // 防连点发两条
    this._sending = true

    api.addComment(this.postId, text)
      .then((res) => {
        this.setData({
          comments: [res.comment].concat(this.data.comments),
          inputValue: '',
          post: Object.assign({}, this.data.post, {
            commentCount: (this.data.post.commentCount || 0) + 1,
          }),
        })
      })
      .catch((err) => {
        console.error('评论失败', err)
        wx.showToast({ title: err.message || '评论失败', icon: 'none' })
      })
      .then(() => { this._sending = false })
  },
})
