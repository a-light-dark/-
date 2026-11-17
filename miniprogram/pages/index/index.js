// pages/index/index.js —— 首页：帖子列表、板块筛选、分页加载

const api = require('../../utils/api.js')

const TABS = ['最新', '日常投稿', '树洞', '表白墙', '新鲜事', '二手', '我关注的']
// 四个分类入口：点一下按话题筛选帖子（再点一下取消）
const ENTRIES = [
  { name: '跑腿代取', icon: '🏃', tag: '跑腿代取' },
  { name: '学习搭子', icon: '📚', tag: '学习搭子' },
  { name: '失物招领', icon: '🔑', tag: '失物招领' },
  { name: '脱单交友', icon: '💘', tag: '脱单交友' },
]
const PAGE_SIZE = 10

Page({
  data: {
    entries: ENTRIES,
    tabs: TABS,
    currentTab: 0,
    followTab: TABS.length - 1, // 「我关注的」是最后一个 tab
    followedTags: [],           // 我关注了哪些话题
    entryTag: '',      // 分类入口筛的话题（空 = 没筛）
    sort: 'new',       // 排序：new 最新 / hot 最热 / views 最多浏览
    sortOptions: [
      { key: 'new', label: '最新' },
      { key: 'hot', label: '最热' },
      { key: 'views', label: '浏览' },
    ],
    posts: [],
    hotPost: null,
    hotIsToday: false, // 热榜是不是「今天」的帖子
    hotTopics: [],     // 热门话题运营位（按最近帖子标签计数）
    announcements: [], // 圈主发的公告（siteData 代读）
    bannerText: '',    // 圈主在运营配置里设的 banner 文案
    indexAd: null,     // 首页广告位（管理台 → 广告管理 → 首页 banner）
    loading: false,
    hasMore: true,
    offline: false, // true = 正在用本地演示数据
    privacyVisible: false, // 首次进入时的隐私提示
  },

  onLoad() {
    // 首屏只拉一次列表：关注列表等真正切到「我关注的」时再拉，少一次数据库往返
    this.loadFirst()
    this.loadHot()
    this.loadHotTopics()
    this.loadSiteData()
    // 没同意过隐私政策就先弹提示（同意后不再打扰）
    if (!wx.getStorageSync('privacyAgreed')) {
      this.setData({ privacyVisible: true })
    }
    // 首次启动且资料还是系统默认昵称/头像 → 弹一次「微信授权头像昵称」页
    this.maybeOpenAuth()
  },

  // 只弹一次：资料是默认「同学XXXX」/😀 且从没弹过授权页时，进授权页
  maybeOpenAuth() {
    if (this._authChecked) return
    this._authChecked = true
    if (wx.getStorageSync('authSeen')) return
    const app = getApp()
    app.ready().then(() => {
      const u = app.globalData.userInfo
      if (!u) return
      const isDefault = /^同学[0-9A-Za-z]{4}$/.test(u.nickname || '') || u.avatar === '😀'
      if (!isDefault) return
      wx.setStorageSync('authSeen', true)
      setTimeout(() => wx.navigateTo({ url: '/pages/auth/auth' }), 600)
    }).catch(() => {})
  },

  // 公告 + banner 文案 + 广告位（圈主在管理台发的）
  loadSiteData() {
    api.fetchSiteData().then((res) => {
      const list = (res.announcements || []).slice(0, 3)
      const ads = (res.ads || []).filter((a) => (a.position || 'home_banner') === 'home_banner').slice(0, 1)
      this.setData({ announcements: list, bannerText: res.bannerText || '', indexAd: ads[0] || null })
      // 曝光只报一次（本次启动），点击在 onAdTap 里报
      if (ads[0] && !this._adViewReported) {
        this._adViewReported = true
        api.reportAd(ads[0].id, 'view')
      }
    }).catch(() => {})
  },

  // 点广告：上报点击，按配置跳详情/页面，没配就提示
  onAdTap() {
    const ad = this.data.indexAd
    if (!ad) return
    api.reportAd(ad.id, 'click')
    if (ad.linkType === 'post' && ad.linkValue) {
      wx.navigateTo({ url: '/pages/detail/detail?id=' + encodeURIComponent(ad.linkValue) })
      return
    }
    if (ad.linkType === 'page' && ad.linkValue) {
      wx.navigateTo({ url: ad.linkValue })
      return
    }
    wx.showToast({ title: '广告位展示中', icon: 'none' })
  },

  // 点公告看全文
  onAnnounceTap(e) {
    const title = e.currentTarget.dataset.title
    const content = e.currentTarget.dataset.content
    wx.showModal({ title: '📢 ' + title, content: content, showCancel: false, confirmText: '知道了' })
  },

  // 每个 tab / 分类入口 / 排序组合一份缓存，20 秒内切回来直接用，不再白屏重拉
  cacheKey() {
    const tail = ':' + (this.data.sort || 'new')
    if (this.isFollowTab()) return 'follow' + tail
    if (this.data.entryTag) return 'entry:' + this.data.entryTag + tail
    return 'tab:' + this.data.currentTab + tail
  },

  // 我关注的话题（“我关注的” tab 用它筛帖子）
  loadFollows() {
    return api.fetchFollowedTopics()
      .then((tags) => {
        const next = tags || []
        const changed = JSON.stringify(next) !== JSON.stringify(this.data.followedTags || [])
        if (changed && this._cache) this._cache.follow = null
        this.setData({ followedTags: next })
      })
      .catch(() => {})
  },

  // 当前是不是「我关注的」tab
  isFollowTab() {
    return this.data.currentTab === this.data.followTab
  },

  // 同意隐私政策
  onPrivacyAgree() {
    wx.setStorageSync('privacyAgreed', true)
    this.setData({ privacyVisible: false })
    wx.showToast({ title: '已同意', icon: 'none' })
  },

  // 暂不同意：说明后退出
  onPrivacyReject() {
    wx.showModal({
      title: '需要同意后才能使用',
      content: '校园圈需要读取你的微信身份来保存帖子、评论和互助订单。不同意的话无法使用，你可以稍后再来。',
      showCancel: false,
      confirmText: '知道了',
    })
  },

  goAgreement() {
    wx.navigateTo({ url: '/pages/agreement/agreement' })
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' })
  },

  // 从发帖页回来时重新拉一次，保证刚发的帖子能看到
  // （只在「刚发过帖」或下拉刷新时重拉，避免每次返回都跳回顶部）
  onShow() {
    const app = getApp()
    const dirty = !!(app && app.globalData && app.globalData.postsDirty)
    if (this._shownOnce && dirty) {
      app.globalData.postsDirty = false
      this._cache = {}
      this.loadFollows().then(() => this.loadFirst(true))
      this.loadHot()
    } else if (this._shownOnce && this.isFollowTab()) {
      // 从话题页返回：关注状态可能变了，只刷新「我关注的」
      this.loadFollows().then(() => this.loadFirst(true))
    }
    this._shownOnce = true
  },

  // 当前要筛选的话题：分类入口优先，其次板块 tab（最新 / 我关注的 = 不按话题查）
  currentTag() {
    if (this.data.entryTag) return this.data.entryTag
    if (this.data.currentTab === 0 || this.isFollowTab()) return ''
    return TABS[this.data.currentTab]
  },

  // 第一页（下拉刷新、刚发过帖时传 true 跳过缓存）
  loadFirst(force) {
    const tag = this.currentTag()
    const key = this.cacheKey()
    this._cache = this._cache || {}
    const cached = this._cache[key]
    if (!force && cached && Date.now() - cached.ts < 20000) {
      this.setData({
        posts: cached.list,
        hasMore: cached.hasMore,
        offline: cached.offline,
        loading: false,
      })
      return Promise.resolve()
    }
    this.setData({ loading: true })

    // 「我关注的」：取一页帖子，本地按关注的话题筛，再按当前排序规则排
    if (this.isFollowTab()) {
      const followed = this.data.followedTags || []
      const sortKey = this.data.sort === 'hot' ? 'likeCount' : this.data.sort === 'views' ? 'views' : 'createdAt'
      return api.fetchPosts({ page: 0, pageSize: 30, tag: '', sort: this.data.sort }).then((res) => {
        const list = (res.list || []).filter(function (p) {
          return (p.tags || []).some(function (t) { return followed.indexOf(t) > -1 })
        })
        if (this.data.sort !== 'new') {
          list.sort(function (a, b) { return (b[sortKey] || 0) - (a[sortKey] || 0) })
        }
        this._cache[key] = { list: list, hasMore: false, offline: !!res.offline, ts: Date.now() }
        this.setData({
          posts: list,
          loading: false,
          hasMore: false,
          offline: !!res.offline,
        })
      }).catch((err) => {
        console.error('加载关注帖子失败', err)
        this.setData({ loading: false, hasMore: false })
        wx.showToast({ title: '加载失败，看控制台', icon: 'none' })
      })
    }

    return api.fetchPosts({ page: 0, pageSize: PAGE_SIZE, tag: tag, sort: this.data.sort }).then((res) => {
      this._cache[key] = { list: res.list, hasMore: res.hasMore, offline: !!res.offline, ts: Date.now() }
      this.setData({
        posts: res.list,
        loading: false,
        hasMore: res.hasMore,
        offline: !!res.offline,
      })
    }).catch((err) => {
      console.error('加载帖子失败：先去云开发控制台确认 posts 集合和数据权限', err)
      this.setData({ loading: false, hasMore: false })
      wx.showToast({ title: '加载失败，看控制台', icon: 'none' })
    })
  },

  // 今日热榜：今天发的帖子里点赞最多的那条（今天还没人发就退回全站最热）
  loadHot() {
    api.fetchHotPost().then((res) => {
      const post = res && res.post
      if (post) this.setData({ hotPost: post, hotIsToday: !!res.isToday })
    }).catch(() => {})
  },

  // 热门话题运营位：最近 200 条帖子按标签计数，取前 6 个
  loadHotTopics() {
    api.fetchHotTopics(6).then((list) => {
      this.setData({ hotTopics: list || [] })
    }).catch(() => {})
  },

  // 上拉加载下一页（「我关注的」只取一页，不做分页）
  loadMore() {
    if (this.data.loading || !this.data.hasMore) return
    if (this.isFollowTab()) return
    const tag = this.currentTag()
    const nextPage = Math.floor(this.data.posts.length / PAGE_SIZE)
    this.setData({ loading: true })
    api.fetchPosts({ page: nextPage, pageSize: PAGE_SIZE, tag: tag, sort: this.data.sort }).then((res) => {
      const list = this.data.posts.concat(res.list)
      const key = this.cacheKey()
      this._cache = this._cache || {}
      this._cache[key] = { list: list, hasMore: res.hasMore, offline: this.data.offline, ts: Date.now() }
      this.setData({
        posts: list,
        loading: false,
        hasMore: res.hasMore,
      })
    }).catch((err) => {
      console.error('加载更多失败', err)
      this.setData({ loading: false })
    })
  },

  onReachBottom() {
    this.loadMore()
  },

  onPullDownRefresh() {
    this.loadFirst(true).then(() => this.loadHot()).then(() => wx.stopPullDownRefresh())
  },

  onTabTap(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (index === this.data.currentTab && !this.data.entryTag) return
    this.setData({ currentTab: index, entryTag: '' })
    if (index === this.data.followTab) {
      this.loadFollows().then(() => this.loadFirst())
      return
    }
    this.loadFirst()
  },

  // 点分类入口：按话题筛选，再点一下取消
  onEntryTap(e) {
    const tag = e.currentTarget.dataset.tag || ''
    if (!tag) return
    if (this.data.entryTag === tag) {
      this.setData({ entryTag: '' })
    } else {
      this.setData({ entryTag: tag, currentTab: 0 })
    }
    this.loadFirst()
  },

  clearEntryFilter() {
    if (!this.data.entryTag) return
    this.setData({ entryTag: '' })
    this.loadFirst()
  },

  // 切换排序：最新 / 最热（点赞）/ 浏览
  onSortTap(e) {
    const sort = e.currentTarget.dataset.sort || 'new'
    if (sort === this.data.sort) return
    this.setData({ sort: sort })
    this.loadFirst(true)
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  },

  goSearch() {
    wx.navigateTo({ url: '/pages/search/search' })
  },

  goHot() {
    if (!this.data.hotPost) return
    wx.navigateTo({ url: '/pages/detail/detail?id=' + this.data.hotPost.id })
  },

  // 点帖子作者头像/昵称：进他的个人主页（catchtap，不会跳到帖子详情）
  goUser(e) {
    const openid = e.currentTarget.dataset.openid
    if (e.currentTarget.dataset.anon) { wx.showToast({ title: '匿名帖不显示作者主页', icon: 'none' }); return }
    if (!openid) {
      wx.showToast({ title: '演示数据没有主页', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/user/user?openid=' + encodeURIComponent(openid) })
  },

  // 进本周榜单（热榜右侧）
  goBoard() {
    wx.navigateTo({ url: '/pages/board/board' })
  },

  // 点话题标签进话题页（catchtap，不会跳到帖子详情）
  goTopic(e) {
    const tag = e.currentTarget.dataset.tag
    if (!tag) return
    wx.navigateTo({ url: '/pages/topic/topic?tag=' + encodeURIComponent(tag) })
  },

  // 首页也能分享：转发给同学/群，点开就是首页
  onShareAppMessage() {
    return {
      title: '校园圈 · 分享校园里的新鲜事',
      path: '/pages/index/index',
    }
  },

  // 分享到朋友圈
  onShareTimeline() {
    return {
      title: '校园圈 · 校园里的新鲜事都在这里',
      query: '',
    }
  },

  // 点帖子里的图片：放大看（catchtap，不会跳到详情）
  previewPostImage(e) {
    const pid = e.currentTarget.dataset.pid
    const src = e.currentTarget.dataset.src
    const post = this.data.posts.filter((p) => String(p.id) === String(pid))[0]
    if (!post || !post.images || !post.images.length) return
    wx.previewImage({ current: src, urls: post.images })
  },
})
