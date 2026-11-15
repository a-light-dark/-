// utils/mock.js —— 临时假数据
// 作用：在接入云数据库之前，让页面有东西可显示
// 等接入数据库后，这个文件就可以删掉了

// 帖子：内容 + 话题标签 + 点赞/评论数
const POSTS = [
  {
    id: 1,
    nickname: '野性的蓝天',
    avatar: '🌤️',
    time: '22秒前',
    content: '图书馆不是预约了才能坐吗，预约了到那里发现有人，都说了是我预约的还是一动不动不让位置。',
    tags: ['日常投稿'],
    likeCount: 0,
    commentCount: 0,
  },
  {
    id: 2,
    nickname: '故意的小土豆',
    avatar: '🥔',
    time: '45秒前',
    content: '校级竞赛获奖对保研有帮助吗？定级名单里有吗，有知道的同学说一下～',
    tags: ['日常投稿', '校园生活'],
    likeCount: 3,
    commentCount: 2,
  },
  {
    id: 3,
    nickname: '爱睡懒觉的猫',
    avatar: '🐱',
    time: '3分钟前',
    content: '二食堂新出的炸鸡排好吃！比外卖便宜一半，推荐大家去试试，窗口在二楼最左边。',
    tags: ['美食推荐'],
    likeCount: 18,
    commentCount: 6,
  },
  {
    id: 4,
    nickname: '树洞小号',
    avatar: '🌳',
    time: '10分钟前',
    content: '这周考试全都堆在一起了，感觉复习不完……有没有人一起泡自习室的，互相监督一下。',
    tags: ['树洞', '学习搭子'],
    likeCount: 9,
    commentCount: 4,
  },
  {
    id: 5,
    nickname: '表白墙管理员',
    avatar: '💌',
    time: '半小时前',
    content: '替同学发：想认识每周三晚上在图书馆三楼吹口琴的那位同学，希望你看到这条消息！',
    tags: ['表白墙', '脱单交友'],
    likeCount: 32,
    commentCount: 11,
  },
  {
    id: 6,
    nickname: '拾金不昧的好同学',
    avatar: '🔑',
    time: '2小时前',
    content: '在教学楼门口捡到一把钥匙，失主看到请联系我认领。',
    tags: ['新鲜事', '失物招领'],
    likeCount: 7,
    commentCount: 2,
  },
  {
    id: 7,
    nickname: '毕业甩卖中',
    avatar: '📦',
    time: '昨天',
    content: '毕业清仓：台灯、收纳箱、考研资料，打包带走便宜，主页联系～',
    tags: ['二手'],
    likeCount: 15,
    commentCount: 8,
  },
  {
    id: 8,
    nickname: '快递不等人',
    avatar: '📮',
    time: '5分钟前',
    content: '下午有人去快递站吗？能帮忙带个包裹上五楼就太感谢了，请杯奶茶～',
    tags: ['日常投稿', '跑腿代取'],
    likeCount: 4,
    commentCount: 1,
  },
]

// 互助订单：悬赏跑腿
const HELP_ORDERS = [
  {
    id: 1,
    nickname: '神秘同学178172382',
    avatar: '🕵️',
    time: '1分钟前',
    content: '寝室楼下取个快递送到四楼，东西有点重。',
    amount: '6.80',
    status: '待接单',
  },
  {
    id: 2,
    nickname: 'one（画图版）',
    avatar: '🎨',
    time: '2分钟前',
    content: '帮我从快递站拿一下资料，三张纸，五点之前都可以。',
    amount: '2.55',
    status: '待接单',
  },
  {
    id: 3,
    nickname: '路过的水母',
    avatar: '🐙',
    time: '1小时前',
    content: '取快递送到宿舍楼下，谢谢～',
    amount: '3.00',
    status: '已完成',
  },
]

// 评论（详情页用）
const COMMENTS = [
  {
    id: 101,
    postId: 1,
    nickname: '图书馆常客',
    avatar: '📚',
    content: '三楼东侧一般没人，西侧基本被占满',
    time: '8分钟前',
  },
  {
    id: 102,
    postId: 1,
    nickname: '匿名同学',
    avatar: '🎓',
    content: '刚走，两个位置空出来了',
    time: '5分钟前',
  },
  {
    id: 103,
    postId: 1,
    nickname: '小黄鸭',
    avatar: '🦆',
    content: '谢谢！我马上到',
    time: '3分钟前',
  },
]

module.exports = { POSTS, HELP_ORDERS, COMMENTS }
