// 订阅消息：用户授权一次，之后可以收到评论 / 点赞 / 抢单的微信服务通知。
//
// 怎么拿到模板 ID：
//   1. mp.weixin.qq.com → 功能 → 订阅消息 → 公共模板库
//   2. 搜「评论提醒」「点赞提醒」「订单提醒」，各选一个模板并添加
//   3. 把模板 ID（形如 "abc123..."）填到下面
//   4. 到 cloudfunctions 里对应函数的 TEMPLATE_IDS 填同样的 ID，重新部署
//
// 没填也不会报错：界面上「开启提醒」卡片不会出现，云函数发送时也会跳过。
const TEMPLATE_IDS = {
  comment: '', // 评论提醒
  like: '',    // 点赞提醒
  order: '',   // 抢单 / 订单提醒
}

// 已配置的模板 ID（去空）
function readyIds() {
  return Object.keys(TEMPLATE_IDS)
    .map(function (k) { return TEMPLATE_IDS[k] })
    .filter(function (id) { return !!id })
}

function isReady() {
  return readyIds().length > 0
}

// 弹微信的订阅授权框（一次最多 3 个模板）
function requestSubscribe() {
  const ids = readyIds()
  if (!ids.length) {
    return Promise.reject(new Error('还没配置订阅消息模板'))
  }
  return new Promise(function (resolve, reject) {
    wx.requestSubscribeMessage({
      tmplIds: ids.slice(0, 3),
      success: function (res) { resolve(res) },
      fail: function (err) { reject(err) },
    })
  })
}

module.exports = {
  TEMPLATE_IDS: TEMPLATE_IDS,
  readyIds: readyIds,
  isReady: isReady,
  requestSubscribe: requestSubscribe,
}
