<template>
  <div class="page">
    <div class="page-head">
      <div>
        <div class="page-sub">
          最近 {{ days }} 天内容与互动 · 真实访问量（UV/PV）在微信小程序后台的「统计」里看
        </div>
      </div>
      <div class="head-actions">
        <el-radio-group v-model="days" size="small" @change="load">
          <el-radio-button :value="7">7 天</el-radio-button>
          <el-radio-button :value="14">14 天</el-radio-button>
          <el-radio-button :value="30">30 天</el-radio-button>
        </el-radio-group>
        <el-button :loading="loading" @click="load">刷新</el-button>
      </div>
    </div>

    <div class="kpi-row" v-loading="loading">
      <div class="kpi"><div class="kpi-label">帖子总数</div><div class="kpi-num">{{ totals.posts }}</div><div class="kpi-sub">今天 +{{ today.posts }}</div></div>
      <div class="kpi"><div class="kpi-label">评论总数</div><div class="kpi-num">{{ totals.comments }}</div><div class="kpi-sub">今天 +{{ today.comments }}</div></div>
      <div class="kpi"><div class="kpi-label">同学</div><div class="kpi-num">{{ totals.users }}</div><div class="kpi-sub">今天 +{{ today.users }}</div></div>
      <div class="kpi"><div class="kpi-label">帖子浏览量</div><div class="kpi-num">{{ totals.views }}</div><div class="kpi-sub">累计阅读次数</div></div>
      <div class="kpi"><div class="kpi-label">点赞</div><div class="kpi-num">{{ totals.likes }}</div><div class="kpi-sub">互助单 {{ totals.orders }}</div></div>
      <div class="kpi"><div class="kpi-label">活跃同学</div><div class="kpi-num">{{ activeUsers }}</div><div class="kpi-sub">近 {{ days }} 天发帖或评论</div></div>
    </div>

    <div class="card">
      <div class="card-title">每天新增（发帖 / 评论 / 新同学）</div>
      <div class="chart">
        <div class="chart-col" v-for="s in series" :key="s.day">
          <div class="bars">
            <div class="bar bar-post" :style="{ height: h(s.posts) }" :title="`帖子 ${s.posts}`"></div>
            <div class="bar bar-comment" :style="{ height: h(s.comments) }" :title="`评论 ${s.comments}`"></div>
            <div class="bar bar-user" :style="{ height: h(s.users) }" :title="`新同学 ${s.users}`"></div>
          </div>
          <div class="chart-day">{{ s.day }}</div>
        </div>
      </div>
      <div class="legend">
        <span><i class="dot dot-post"></i>帖子 {{ sum('posts') }}</span>
        <span><i class="dot dot-comment"></i>评论 {{ sum('comments') }}</span>
        <span><i class="dot dot-user"></i>新同学 {{ sum('users') }}</span>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-title">浏览最多</div>
        <div class="rank" v-for="(p, i) in topPosts" :key="p.id">
          <span class="rank-no">{{ i + 1 }}</span>
          <div class="rank-main">
            <div class="rank-text">{{ p.content || '（无内容）' }}</div>
            <div class="muted">{{ p.nickname || '匿名同学' }}</div>
          </div>
          <div class="rank-num">👀 {{ p.views }}</div>
        </div>
        <div class="empty" v-if="!topPosts.length">还没有帖子</div>
      </div>

      <div class="card">
        <div class="card-title">点赞最多</div>
        <div class="rank" v-for="(p, i) in topLiked" :key="p.id">
          <span class="rank-no">{{ i + 1 }}</span>
          <div class="rank-main">
            <div class="rank-text">{{ p.content || '（无内容）' }}</div>
            <div class="muted">{{ p.nickname || '匿名同学' }}</div>
          </div>
          <div class="rank-num">👍 {{ p.likes }}</div>
        </div>
        <div class="empty" v-if="!topLiked.length">还没有帖子</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">话题分布</div>
      <div class="topics">
        <span class="topic" v-for="t in topics" :key="t.tag">#{{ t.tag }} <b>{{ t.count }}</b></span>
        <span class="muted" v-if="!topics.length">还没有话题</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { fetchAnalytics } from '../api.js'

const days = ref(7)
const loading = ref(false)
const totals = ref({ users: 0, posts: 0, comments: 0, likes: 0, orders: 0, views: 0 })
const today = ref({ posts: 0, comments: 0, users: 0 })
const series = ref([])
const topics = ref([])
const topPosts = ref([])
const topLiked = ref([])
const activeUsers = ref(0)

function sum(key) {
  return series.value.reduce((a, s) => a + (s[key] || 0), 0)
}

// 柱状图按当前最大值缩放，最小 2% 让 0 也有底线可看
function h(v) {
  const max = Math.max(1, ...series.value.map((s) => Math.max(s.posts, s.comments, s.users)))
  const pct = Math.max(2, Math.round((v / max) * 100))
  return pct + '%'
}

async function load() {
  loading.value = true
  try {
    const res = await fetchAnalytics(days.value)
    totals.value = res.totals || totals.value
    today.value = res.today || today.value
    series.value = res.series || []
    topics.value = res.topics || []
    topPosts.value = res.topPosts || []
    topLiked.value = res.topLiked || []
    activeUsers.value = res.activeUsers || 0
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.head-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.kpi-row {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 16px;
}
.kpi {
  background: #fff;
  border-radius: 10px;
  padding: 16px 18px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04);
}
.kpi-label {
  font-size: 13px;
  color: #7a8288;
}
.kpi-num {
  margin-top: 6px;
  font-size: 26px;
  font-weight: 700;
  color: #1f2d27;
}
.kpi-sub {
  margin-top: 2px;
  font-size: 12px;
  color: #9aa39e;
}
.card-title {
  font-weight: 600;
  color: #1f2d27;
  margin-bottom: 14px;
}
.chart {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  height: 180px;
  padding: 4px 4px 0;
}
.chart-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
}
.bars {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 4px;
}
.bar {
  width: 8px;
  border-radius: 3px 3px 0 0;
  background: #07c160;
  min-height: 2px;
}
.bar-comment {
  background: #8fd9b0;
}
.bar-user {
  background: #c8d6cf;
}
.chart-day {
  margin-top: 8px;
  font-size: 12px;
  color: #9aa39e;
}
.legend {
  display: flex;
  gap: 20px;
  margin-top: 10px;
  font-size: 12px;
  color: #6d7772;
}
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
}
.dot-post {
  background: #07c160;
}
.dot-comment {
  background: #8fd9b0;
}
.dot-user {
  background: #c8d6cf;
}
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.rank {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid #f1f3f2;
}
.rank:last-child {
  border-bottom: none;
}
.rank-no {
  width: 22px;
  height: 22px;
  line-height: 22px;
  text-align: center;
  border-radius: 50%;
  background: #f3f6f4;
  color: #6d7772;
  font-size: 12px;
  flex: none;
}
.rank-main {
  flex: 1;
  min-width: 0;
}
.rank-text {
  font-size: 14px;
  color: #24322b;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.rank-num {
  flex: none;
  font-size: 13px;
  color: #6d7772;
}
.topics {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.topic {
  padding: 6px 12px;
  border-radius: 999px;
  background: #f1faf5;
  color: #0a7f47;
  font-size: 13px;
}
.empty {
  padding: 20px 0;
  color: #9aa39e;
  font-size: 13px;
}
#app.dark .kpi,
#app.dark .card {
  background: #1b2320;
  color: #e8f0eb;
}
</style>
