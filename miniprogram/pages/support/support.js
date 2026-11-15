// pages/support/support.js —— 客服中心：微信客服会话 + 常见问题 + 工单

const FAQ = [
  {
    q: '为什么我的帖子会出现在好几个分类里？',
    a: '发帖时「话题」可以多选，勾了几个就会出现在几个分类下；不勾任何话题时默认归到「日常投稿」。想只出现在一个分类，就只勾一个话题。',
  },
  {
    q: '抢单之后为什么要等对方确认？',
    a: '互助订单是双向确认：接单人标记完成后，发单人会看到「待确认」，他确认了才算真正完成，之后你们可以互相评价。这样双方都有保障。',
  },
  {
    q: '匿名发帖，别人能看出是我吗？',
    a: '匿名帖只显示「匿名同学」和 🎭，点你的头像也进不了你的主页、看不到你的其他帖子。但后台（圈主）处理举报时能看到真实发布者。',
  },
  {
    q: '举报之后多久会处理？',
    a: '圈主在「我的 → 举报处理」里看到举报，会删除违规帖子或忽略。一般当天处理；你也可以直接在建议反馈里补充说明。',
  },
  {
    q: '换手机、清缓存之后我的资料还在吗？',
    a: '资料存在云端（昵称、头像、帖子、收藏、关注），换手机用同一个微信打开就还在；退出登录不会删除内容。',
  },
  {
    q: '怎么删除我的帖子、评论或账号？',
    a: '帖子：进详情页，自己的帖子底部有「删除这条帖子」；评论：长按自己的评论选「删除」；账号：我的 → 注销账号（会提示先处理完进行中的互助订单）。',
  },
]

Page({
  data: {
    faqs: FAQ,
    openIndex: -1,
  },

  onShareAppMessage() {
    return { title: '校园圈 · 客服中心', path: '/pages/support/support' }
  },

  // 展开/收起一条 FAQ
  onFaqTap(e) {
    const index = Number(e.currentTarget.dataset.index)
    this.setData({ openIndex: this.data.openIndex === index ? -1 : index })
  },

  // 提交工单（复用建议反馈页）
  goFeedback() {
    wx.navigateTo({ url: '/pages/feedback/feedback' })
  },

  // 看使用说明
  goGuide() {
    wx.navigateTo({ url: '/pages/guide/guide' })
  },
})
