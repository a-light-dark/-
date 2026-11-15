// pages/user/user.js —— 个人主页（别人的主页 / 自己的主页）
const api = require('../../utils/api.js')

Page({
  data: {
    openid: '',
    loading: true,
    offline: false,
    profile: null,
    posts: [],
    stats: { postCount: 0, likeCount: 0 },
    isMe: false,
  },

  onLoad(options) {
    const openid = decodeURIComponent((options && options.openid) || '')
    const me = (getApp().globalData && getApp().globalData.openid) || ''
    this.setData({ openid: openid, isMe: !!openid && openid === me })
    this.load()
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh())
  },

  load() {
    if (!this.data.openid) {
      this.setData({ loading: false })
      return Promise.resolve()
    }
    return getApp().ready()
      .then(() => api.fetchUserProfile(this.data.openid))
      .then((res) => {
        this.setData({
          loading: false,
          offline: !!res.offline,
          profile: res.profile,
          posts: res.posts,
          stats: res.stats,
        })
        const name = res.profile && res.profile.nickname
        if (name) wx.setNavigationBarTitle({ title: name })
      })
      .catch((err) => {
        console.error('加载个人主页失败', err)
        this.setData({ loading: false })
        wx.showToast({ title: '加载失败，下拉重试', icon: 'none' })
      })
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  },

  previewImage(e) {
    const pid = e.currentTarget.dataset.pid
    const src = e.currentTarget.dataset.src
    const post = this.data.posts.filter((p) => String(p.id) === String(pid))[0]
    if (!post || !post.images || !post.images.length) return
    wx.previewImage({ current: src, urls: post.images })
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' })
  },

  // 主页不存在时的出口
  goHome() {
    wx.switchTab({ url: '/pages/index/index' })
  },

  onShareAppMessage() {
    const name = (this.data.profile && this.data.profile.nickname) || '同学'
    return {
      title: name + ' 的校园圈主页',
      path: '/pages/user/user?openid=' + encodeURIComponent(this.data.openid),
    }
  },

  // 分享到朋友圈
  onShareTimeline() {
    const name = (this.data.profile && this.data.profile.nickname) || '同学'
    return {
      title: name + ' 的校园圈主页',
      query: 'openid=' + encodeURIComponent(this.data.openid || ''),
    }
  },
})
