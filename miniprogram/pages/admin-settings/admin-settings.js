// pages/admin-settings/admin-settings.js —— 运营配置 + 审计日志

const api = require('../../utils/api.js')

const SETTING_META = [
  { key: 'bannerText', name: '首页公告文案', desc: '首页紫色横幅上的那句话（已生效）', placeholder: '例：🎉 校园圈体验版上线啦', max: 50 },
  { key: 'announcementEnabled', name: '是否显示首页公告', desc: '填 false 隐藏公告卡 / true 显示（默认显示）', placeholder: 'true', max: 10 },
  { key: 'reportReplyText', name: '举报处理回复话术', desc: '你处理举报后，举报人会收到一条系统消息（已生效）', placeholder: '你举报的内容我们看过了，感谢反馈～', max: 50 },
  { key: 'feedbackReplyText', name: '反馈处理回复话术', desc: '你标记反馈已处理后，提交人会收到系统消息（已生效）', placeholder: '你提的建议我们收到啦，已经处理，谢谢！', max: 50 },
]

Page({
  data: {
    loading: true,
    checked: false,
    isAdmin: false,
    metas: SETTING_META,
    settings: {},
    drafts: {},          // key -> 输入中的值
    savingKey: '',
    audit: [],
    auditTotal: 0,
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
        return Promise.all([api.adminSettings(), api.adminAuditList(1).catch(function () { return { list: [], total: 0 } })])
          .then((results) => {
            const settings = (results[0] && results[0].settings) || {}
            const drafts = {}
            SETTING_META.forEach(function (m) {
              drafts[m.key] = settings[m.key] == null ? '' : String(settings[m.key])
            })
            this.setData({
              settings: settings,
              drafts: drafts,
              audit: results[1].list || [],
              auditTotal: results[1].total || 0,
            })
          })
      })
      .catch((err) => {
        wx.showToast({ title: (err && err.message) || '读取失败', icon: 'none' })
      })
      .then(stop)
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key
    const drafts = Object.assign({}, this.data.drafts)
    drafts[key] = e.detail.value
    this.setData({ drafts: drafts })
  },

  save(e) {
    const key = e.currentTarget.dataset.key
    const value = String((this.data.drafts && this.data.drafts[key]) || '')
    if (this.data.savingKey) return
    this.setData({ savingKey: key })
    wx.showLoading({ title: '保存中', mask: true })
    api.adminSetSetting(key, value)
      .then(() => {
        wx.hideLoading()
        const settings = Object.assign({}, this.data.settings)
        settings[key] = value
        this.setData({ savingKey: '', settings: settings })
        wx.showToast({ title: '已保存', icon: 'success' })
        this.loadAudit()
      })
      .catch((err) => {
        wx.hideLoading()
        this.setData({ savingKey: '' })
        wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
      })
  },

  loadAudit() {
    api.adminAuditList(1)
      .then((res) => this.setData({ audit: res.list || [], auditTotal: res.total || 0 }))
      .catch(function () {})
  },
})
