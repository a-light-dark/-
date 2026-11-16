// pages/admin-home/admin-home.js —— 管理台首页（仪表盘 + 功能入口）
// 只有白名单管理员能进；数据全部走 adminApi 网关。

const api = require('../../utils/api.js')

Page({
  data: {
    loading: true,
    checked: false,
    isAdmin: false,
    isOwner: false,
    dash: null,
    navs: [
      { key: 'reports', icon: '🚨', name: '举报处理', desc: '被举报的帖子：删帖或忽略', url: '/pages/admin/admin' },
      { key: 'feedback', icon: '📮', name: '反馈管理', desc: '用户的建议和投诉', url: '/pages/feedback-admin/feedback-admin' },
      { key: 'users', icon: '👥', name: '用户管理', desc: '封禁 / 解封 / 设管理员', url: '/pages/admin-users/admin-users' },
      { key: 'posts', icon: '📄', name: '帖子管理', desc: '置顶 / 删除任意帖子', url: '/pages/admin-posts/admin-posts' },
      { key: 'announce', icon: '📢', name: '公告管理', desc: '发公告、置顶、下架', url: '/pages/admin-announce/admin-announce' },
      { key: 'settings', icon: '⚙️', name: '运营配置', desc: 'banner 文案、回复话术、审计日志', url: '/pages/admin-settings/admin-settings' },
      { key: 'trash', icon: '🗑', name: '回收站', desc: '误删的帖子和评论可以恢复', url: '/pages/admin-trash/admin-trash' },
      { key: 'words', icon: '🚫', name: '敏感词库', desc: '加校园特有的拦截词', url: '/pages/admin-words/admin-words' },
    ],
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
        this.setData({ checked: true, isAdmin: who.admin, isOwner: who.owner })
        if (!who.admin) return null
        return api.adminDashboard().then((res) => this.setData({ dash: res.data || res }))
      })
      .catch((err) => {
        console.error('读取仪表盘失败', err)
        wx.showToast({ title: (err && err.message) || '读取失败', icon: 'none' })
      })
      .then(stop)
  },

  goNav(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.navigateTo({ url: url })
  },

  goReports() {
    wx.navigateTo({ url: '/pages/admin/admin' })
  },
})
