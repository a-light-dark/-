// pages/topic/topic.js —— 话题页：某个话题下的全部帖子（可以关注这个话题）
const api = require('../../utils/api.js')

Page({
  data: {
    tag: '',        // 话题名（从 URL 里取）
    meta: null,     // 话题的 emoji / 介绍
    posts: [],
    loading: true,
    offline: false,
    notFound: false,    // 没带话题名进来（比如直接从分享链接打开空参数）
    following: false,   // 我有没有关注这个话题
    followBusy: false,  // 防止连点
  },

  onLoad(options) {
    const tag = decodeURIComponent((options && options.tag) || '')
    if (!tag) {
      // 没有话题名：不硬退（可能是 reLaunch/分享进来的，没有上一页），显示空状态
      this.setData({ loading: false, notFound: true })
      return
    }
    this.setData({ tag: tag, meta: api.topicMeta(tag) })
    wx.setNavigationBarTitle({ title: '#' + tag })
    this.load()
    this.loadFollow()
  },

  onPullDownRefresh() {
    this.load().then(function () {
      wx.stopPullDownRefresh()
    })
  },

  // 当前是否已关注
  loadFollow() {
    return api.fetchFollowedTopics().then((tags) => {
      this.setData({ following: (tags || []).indexOf(this.data.tag) > -1 })
    }).catch(() => {})
  },

  // 关注 / 取关
  onFollowTap() {
    if (this.data.followBusy) return
    this.setData({ followBusy: true })
    api.toggleFollowTopic(this.data.tag)
      .then((res) => {
        this.setData({ following: !!(res && res.following), followBusy: false })
        wx.showToast({ title: res && res.following ? '已关注这个话题' : '已取消关注', icon: 'none' })
      })
      .catch((err) => {
        this.setData({ followBusy: false })
        wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' })
      })
  },

  load() {
    this.setData({ loading: true })
    return api.fetchPosts({ tag: this.data.tag, page: 0, pageSize: 50 }).then((res) => {
      this.setData({
        posts: res.list,
        loading: false,
        offline: !!res.offline,
      })
    }).catch((err) => {
      console.error('话题加载失败', err)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败，看控制台', icon: 'none' })
    })
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  },

  // 点话题页里的头像/昵称：进作者主页
  goUser(e) {
    const openid = e.currentTarget.dataset.openid
    if (e.currentTarget.dataset.anon) { wx.showToast({ title: '匿名帖不显示作者主页', icon: 'none' }); return }
    if (!openid) return
    wx.navigateTo({ url: '/pages/user/user?openid=' + encodeURIComponent(openid) })
  },

  previewPostImage(e) {
    const pid = e.currentTarget.dataset.id
    const src = e.currentTarget.dataset.src
    let post = null
    for (let i = 0; i < this.data.posts.length; i++) {
      if (String(this.data.posts[i].id) === String(pid)) {
        post = this.data.posts[i]
        break
      }
    }
    if (!post || !post.images || !post.images.length) return
    wx.previewImage({ current: src, urls: post.images })
  },

  // 发帖页是 tabBar 页面，switchTab 不能带参数，先把话题存在全局里
  goPublish() {
    const app = getApp()
    app.globalData.pendingTopic = this.data.tag
    wx.switchTab({ url: '/pages/publish/publish' })
  },

  // 转发给同学/群
  onShareAppMessage() {
    return {
      title: '#' + this.data.tag + ' · 校园圈话题',
      path: '/pages/topic/topic?tag=' + encodeURIComponent(this.data.tag || ''),
    }
  },

  // 分享到朋友圈
  onShareTimeline() {
    return {
      title: '#' + this.data.tag + ' · 校园圈话题',
      query: 'tag=' + encodeURIComponent(this.data.tag || ''),
    }
  },
})
