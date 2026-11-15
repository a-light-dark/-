// cloudfunctions/login/index.js —— 返回调用者的 openid，并顺手保证 users 里有资料
// 为什么在这里建 users 文档：正式上线前会把 users 集合权限收紧成「所有用户可读」（客户端不能写），
// 所以「首次登录自动创建资料」这种事必须由服务端做。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function pickProfile(doc) {
  return {
    id: doc._id,
    nickname: doc.nickname || '',
    avatar: doc.avatar || '😀',
  }
}

exports.main = async () => {
  const wxContext = cloud.getWXContext()
  const OPENID = wxContext.OPENID

  let profile = null
  try {
    const res = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
    if (res.data && res.data.length) {
      profile = pickProfile(res.data[0])
    } else {
      const doc = {
        nickname: '同学' + String(OPENID || '').slice(-4),
        avatar: '😀',
        createdAt: db.serverDate(),
        _openid: OPENID,
      }
      const add = await db.collection('users').add({ data: doc })
      profile = pickProfile(Object.assign({ _id: add._id }, doc))
    }
  } catch (err) {
    // users 集合没建 / 权限还没配好都不该影响登录
    console.warn('[login] 读写用户资料失败', err.errCode, err.errMsg)
  }

  return {
    openid: OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID,
    profile: profile,
  }
}
