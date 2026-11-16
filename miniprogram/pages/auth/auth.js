// pages/auth/auth.js —— 微信授权页：一次性申请头像 + 昵称（微信官方组件：chooseAvatar / type=nickname）
// 说明：微信 2022 年后不再允许静默读微信头像昵称，官方给出的就是这两个原生组件；
// 本页把它们包装成「授权弹窗」一样的体验：选头像 → 填昵称 → 点「允许」保存。
const api = require('../../utils/api.js')

Page({
  data: {
    avatarPreview: '',   // 这次选的微信头像（本地临时路径）
    avatarChosen: false, // 是否点了选头像
    nickname: '',        // 输入框内容
    saving: false,
  },

  onLoad() {
    const u = getApp().globalData.userInfo || {}
    this.setData({ nickname: u.nickname || '' })
  },

  // 微信头像：open-type="chooseAvatar" 的回调（真机会弹「用微信头像」，模拟器只有相册）
  onChooseAvatar(e) {
    const url = (e.detail && e.detail.avatarUrl) || ''
    if (!url) return
    this.setData({ avatarPreview: url, avatarChosen: true })
  },

  onNicknameInput(e) {
    this.setData({ nickname: String(e.detail.value || '').slice(0, 12) })
  },

  // 允许：保存头像昵称后返回
  onAllow() {
    if (this.data.saving) return
    const app = getApp()
    const cur = app.globalData.userInfo || {}
    const nickname = this.data.nickname.trim()
    if (nickname.length < 2) {
      wx.showToast({ title: '昵称最少 2 个字', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    wx.showLoading({ title: '保存中', mask: true })

    let avatarTask = Promise.resolve('')
    if (this.data.avatarChosen) {
      avatarTask = api.uploadAvatar(this.data.avatarPreview).catch(() => '')
    }
    avatarTask
      .then((fileID) => {
        return api.saveProfile({
          nickname: nickname,
          avatar: fileID || cur.avatar || '😀',
        })
      })
      .then(() => {
        wx.hideLoading()
        wx.setStorageSync('authDone', true)
        wx.showToast({ title: '已授权', icon: 'success' })
        setTimeout(() => this.goBack(), 600)
      })
      .catch((err) => {
        wx.hideLoading()
        this.setData({ saving: false })
        wx.showToast({ title: (err && err.message) || '保存失败，再试一次', icon: 'none' })
      })
  },

  // 跳过：先逛逛，之后在「我的 → 个人资料」还能授权
  onSkip() {
    wx.setStorageSync('authDone', true)
    this.goBack()
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/index/index' }),
    })
  },
})
