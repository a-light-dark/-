Page({
  data: {},

  onShareAppMessage() {
    return {
      title: '校园圈使用说明 · 三分钟上手',
      path: '/pages/guide/guide',
    }
  },

  goFeedback() {
    wx.navigateTo({ url: '/pages/feedback/feedback' })
  },

  goPublish() {
    wx.switchTab({ url: '/pages/publish/publish' })
  },

  goHelp() {
    wx.switchTab({ url: '/pages/help/help' })
  },

  goRules() {
    wx.navigateTo({ url: '/pages/rules/rules' })
  },

  goAgreement() {
    wx.navigateTo({ url: '/pages/agreement/agreement' })
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' })
  },

  goAccount() {
    wx.navigateTo({ url: '/pages/account/account' })
  },
})
