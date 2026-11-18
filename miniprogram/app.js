// app.js —— 小程序入口：初始化云开发 + 拿到用户 openid
// 云环境 ID 在「云开发控制台 → 设置」里能看到，格式像 cloud1-xxxxxxxx
const CLOUD_ENV = 'cloud1-d6g26wz61eca836b8'

App({
  globalData: {
    openid: '',      // 当前用户的唯一 id（由 login 云函数返回）
    userInfo: null,  // { nickname, avatar }
    cloudReady: false, // 云端是否可用（false 时页面自动用本地演示数据）
  },

  onLaunch() {
    if (!wx.cloud || !CLOUD_ENV) {
      console.warn('[app] 没有配置云环境，先用本地演示数据')
      return
    }
    wx.cloud.init({ env: CLOUD_ENV, traceUser: true })
    // 提前登录一次，页面进来时就能直接用
    this.ready()
  },

  // 每次回到前台先刷一次红点（兜底），同时在后台开一个实时监听：
  // 有人给你评论/点赞/抢单时，数据库一变更就推送过来，不用等轮询
  onShow() {
    if (this.globalData.cloudReady) {
      require('./utils/api.js').refreshBadge()
      this.startBadgeWatch()
    }
    // 实时监听不可用（权限没放开 / 环境不支持）时才退回每分钟轮询
    if (this._badgeTimer) clearInterval(this._badgeTimer)
    this._badgeTimer = setInterval(() => {
      if (this.globalData.cloudReady && !this._badgeWatcher) require('./utils/api.js').refreshBadge()
    }, 60000)
  },

  // 切后台就断开监听、停掉轮询，避免白耗连接和调用次数
  onHide() {
    this.stopBadgeWatch()
    if (this._badgeTimer) {
      clearInterval(this._badgeTimer)
      this._badgeTimer = null
    }
  },

  // 实时红点：监听 notices 里「发给我的、还没读的」记录
  startBadgeWatch() {
    if (this._badgeWatcher || !this.globalData.openid) return
    try {
      const db = wx.cloud.database()
      this._badgeWatcher = db.collection('notices')
        .where({ toOpenid: this.globalData.openid, read: false })
        .watch({
          onChange: (snapshot) => {
            const count = (snapshot.docs || []).length
            this.applyBadge(count)
          },
          onError: (err) => {
            console.warn('[app] 实时红点不可用，退回轮询', err && (err.errMsg || err.message))
            this._badgeRealtime = false
            this._badgeWatcher = null
          },
        })
      this._badgeRealtime = true
    } catch (err) {
      console.warn('[app] 实时红点启动失败，退回轮询', err)
      this._badgeRealtime = false
      this._badgeWatcher = null
    }
  },

  stopBadgeWatch() {
    if (!this._badgeWatcher) return
    try { this._badgeWatcher.close() } catch (e) {}
    this._badgeWatcher = null
  },

  // 把未读数同步到 tabBar 小红点（<0 表示先不变）
  applyBadge(count) {
    const n = Number(count) || 0
    if (n > 0) {
      wx.setTabBarBadge({ index: 3, text: n > 99 ? '99+' : String(n), fail: () => {} })
    } else {
      wx.removeTabBarBadge({ index: 3, fail: () => {} })
    }
  },

  // 所有页面共用：等云开发登录完成（只会真正执行一次，重复调用返回同一个 Promise）
  // 返回 true = 云端可用；false = 退回本地演示数据
  ready() {
    if (this._readyPromise) return this._readyPromise
    // 刚失败过就先别再试，等下一个页面时再重试（避免每次接口调用都卡在登录上）
    if (this._failedAt && Date.now() - this._failedAt < 15000) {
      return Promise.resolve(false)
    }

    this._readyPromise = wx.cloud.callFunction({ name: 'login' })
      .then((res) => {
        const result = res.result || {}
        if (!result.openid) throw new Error('login 云函数没有返回 openid')
        this.globalData.openid = result.openid
        this.globalData.cloudReady = true

        // login 云函数会顺手把 users 里的资料建好/读出来一起返回
        if (result.profile) return result.profile

        // 兼容老版本 login（没返回 profile）：只读一次，不写库
        const api = require('./utils/api.js')
        return api.ensureProfile(result.openid).catch((err) => {
          console.warn('[app] 读取用户资料失败，先用临时昵称', err)
          return null
        })
      })
      .then((profile) => {
        this.globalData.userInfo = profile || {
          nickname: '同学' + String(this.globalData.openid).slice(-4),
          avatar: '😀',
        }
        this._failedAt = 0
        // 登录成功后刷新「消息」tab 的未读红点，并开实时监听（失败不影响页面）
        require('./utils/api.js').refreshBadge()
        this.startBadgeWatch()
        return true
      })
      .catch((err) => {
        console.error('[app] 云开发登录失败，自动改用本地演示数据', err)
        this.globalData.cloudReady = false
        this._failedAt = Date.now()
        this._readyPromise = null // 清掉缓存，之后进页面还能再试一次
        return false
      })

    return this._readyPromise
  },
})
