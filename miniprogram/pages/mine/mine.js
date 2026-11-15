// pages/mine/mine.js —— 我的页面：用户资料 + 发帖统计

const api = require('../../utils/api.js')

// 基础菜单（通用，不区分学校）；管理员会多一项「举报处理」
const BASE_MENUS = [
  '个人资料', '我的帖子',
  '历史评论', '我的收藏',
  '我的关注', '我的收益',
  '客服中心', '建议反馈',
  '用户协议', '隐私政策',
  '社区规范', '注销账号',
]

Page({
  data: {
    userInfo: null,       // 昵称、头像（登录后才有）
    hasAvatarImage: false, // 头像是图片还是表情
    uid: '未登录',         // 用户ID（openid 末 8 位）
    postCount: 0,         // 已发帖
    likeCount: 0,         // 被点赞
    isAdmin: false,       // 是不是圈主
    menus: BASE_MENUS,    // 菜单项
  },

  onShow() {
    const app = getApp()
    app.ready()
      .then(() => {
        const g = app.globalData
        this.setData({ uid: g.openid ? '…' + String(g.openid).slice(-8) : '未登录' })
        return Promise.all([
          api.fetchMyStats().catch(() => null),
          api.fetchIsAdmin().catch(() => false),
        ]).then((res) => {
          const stats = res[0]
          const isAdmin = res[1]
          this.setData({
            isAdmin: isAdmin,
            menus: isAdmin ? BASE_MENUS.concat(['举报处理', '反馈管理']) : BASE_MENUS,
          })
          if (!stats) return
          this.setData({
            userInfo: { nickname: stats.nickname, avatar: stats.avatar },
            hasAvatarImage: api.isImagePath(stats.avatar),
            postCount: stats.postCount,
            likeCount: stats.likeCount,
          })
        })
      })
      .catch((err) => {
        console.error('读取我的资料失败', err)
      })
  },

  // 进个人资料页（改昵称、换头像）
  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' })
  },

  // 登录：打开小程序就已经是微信身份（云开发自动给 openid），不需要按钮授权
  login() {
    wx.showToast({ title: '已自动登录', icon: 'none' })
  },

  // 右上角按钮：有资料提示切换社区，没资料就提示登录
  onUserPill() {
    if (this.data.userInfo) {
      wx.showToast({ title: '切换社区即将上线', icon: 'none' })
    } else {
      this.login()
    }
  },

  // 菜单点击：「个人资料」进编辑页，「我的收藏」「我的帖子」「历史评论」进对应列表，其它先提示即将上线
  onMenuTap(e) {
    const name = e.currentTarget.dataset.name
    if (name === '个人资料') {
      this.goProfile()
      return
    }
    if (name === '我的收藏') {
      this.goFavorites()
      return
    }
    if (name === '我的帖子') {
      this.goMyContent('posts')
      return
    }
    if (name === '历史评论') {
      this.goMyContent('comments')
      return
    }
    if (name === '我的收益') {
      wx.navigateTo({ url: '/pages/earnings/earnings' })
      return
    }
    if (name === '用户协议') {
      wx.navigateTo({ url: '/pages/agreement/agreement' })
      return
    }
    if (name === '隐私政策') {
      wx.navigateTo({ url: '/pages/privacy/privacy' })
      return
    }
    if (name === '社区规范') {
      this.goRules()
      return
    }
    if (name === '注销账号') {
      wx.navigateTo({ url: '/pages/account/account' })
      return
    }
    if (name === '建议反馈') {
      wx.navigateTo({ url: '/pages/feedback/feedback' })
      return
    }
    if (name === '举报处理') {
      wx.navigateTo({ url: '/pages/admin/admin' })
      return
    }
    if (name === '反馈管理') {
      wx.navigateTo({ url: '/pages/feedback-admin/feedback-admin' })
      return
    }
    this.comingSoon(e)
  },

  // 社区规范
  goRules() {
    wx.navigateTo({ url: '/pages/rules/rules' })
  },

  // 进我的收藏
  goFavorites() {
    wx.navigateTo({ url: '/pages/favorites/favorites' })
  },

  // 进我的内容（tab：posts 我的帖子 / comments 历史评论）
  goMyContent(tab) {
    wx.navigateTo({ url: '/pages/my-posts/my-posts?tab=' + tab })
  },

  // 还没做的功能
  comingSoon(e) {
    const name = e.currentTarget.dataset.name
    wx.showToast({ title: name + '即将上线', icon: 'none' })
  },
})
