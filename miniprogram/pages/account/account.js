// pages/account/account.js —— 注销账号
const api = require('../../utils/api.js')

Page({
  data: {
    busy: false,
    uid: '未登录',
  },

  onShow() {
    const g = getApp().globalData
    this.setData({ uid: g.openid ? '…' + String(g.openid).slice(-8) : '未登录' })
  },

  onDelete() {
    if (this.data.busy) return
    const that = this
    wx.showModal({
      title: '确认注销账号？',
      content: '注销后，你的昵称头像、发布的帖子、评论、点赞、收藏和消息都会删除，且无法恢复。',
      confirmText: '确认注销',
      confirmColor: '#e64340',
      success(res) {
        if (res.confirm) that.doDelete()
      },
    })
  },

  doDelete() {
    const that = this
    this.setData({ busy: true })
    wx.showLoading({ title: '处理中', mask: true })

    api.deleteAccount()
      .then(function (res) {
        wx.hideLoading()
        const app = getApp()
        app.globalData.userInfo = null
        app.globalData.openid = ''
        app.globalData.cloudReady = false
        app.globalData.postsDirty = true
        wx.showToast({ title: res.offline ? '已清理本地数据' : '账号已注销', icon: 'none' })
        setTimeout(function () {
          wx.reLaunch({ url: '/pages/index/index' })
        }, 900)
      })
      .catch(function (err) {
        wx.hideLoading()
        that.setData({ busy: false })
        wx.showModal({
          title: '暂时没能注销',
          content: (err && err.message) || '请稍后再试',
          showCancel: false,
        })
      })
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' })
  },
})
