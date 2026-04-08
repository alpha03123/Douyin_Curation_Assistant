<template>
  <AppShell>
    <template #header>
      <section class="hero-panel">
        <p class="hero-panel__kicker">Operations Overview</p>
        <div class="hero-panel__main">
          <div>
            <h2 class="hero-panel__title">内容运营工作台</h2>
            <p class="hero-panel__desc">
              首页只回答三个问题：系统是否可用、数据是否在增长、下一步该去哪一页直接开干。
            </p>
            <div class="hero-panel__actions">
              <el-button type="primary" @click="go('/keywords')">去关键词中心</el-button>
              <el-button @click="go('/works')">去候选作品库</el-button>
              <el-button @click="go('/recommend-works')">去推荐作品库</el-button>
            </div>
          </div>
          <div class="hero-panel__stats">
            <el-tag :type="health.ok ? 'success' : 'danger'" effect="dark">
              {{ health.ok ? "服务正常" : "服务异常" }}
            </el-tag>
            <el-tag>{{ health.database?.label || "database unknown" }}</el-tag>
            <el-tag>client {{ health.clientOrigin || "-" }}</el-tag>
          </div>
        </div>
      </section>
    </template>

    <section class="page-grid three">
      <MetricCard label="关键词总数" :value="dashboard.keywords" note="当前维护中的采集入口" />
      <MetricCard label="候选作品" :value="dashboard.works" note="可继续分析与直接互动" />
      <MetricCard label="已分析作品" :value="dashboard.analyzedWorks" note="已抓评论并完成评分" />
      <MetricCard label="候选作者" :value="dashboard.creatorCandidates" note="由评论特征聚合而来" />
      <MetricCard label="推荐作品" :value="dashboard.recommendWorks" note="来自推荐流监听与曝光采集" />
      <MetricCard label="下载任务" :value="dashboard.downloads" note="当前累计下载任务数" />
    </section>

    <section class="page-grid two">
      <el-card class="panel-card">
        <template #header>
          <div class="panel-toolbar">
            <div>
              <h3 class="panel-title">当前工作流</h3>
              <p class="panel-desc">建议顺序：采集 -> 分析 -> 直接互动 -> 复盘结果</p>
            </div>
          </div>
        </template>

        <el-steps direction="vertical" :active="4" finish-status="success">
          <el-step title="确认采集环境" description="先检查 Cookie、浏览器会话和连续采集状态。" />
          <el-step title="补齐评论分析" description="优先处理高互动作品，完善词云和高赞评论。" />
          <el-step title="筛选候选作者" description="基于聚合评分做人审，沉淀值得长期跟进的作者。" />
          <el-step title="直接执行动作" description="进入候选作品库或推荐作品库，直接执行点赞、收藏、关注和评论。" />
        </el-steps>
      </el-card>

      <el-card class="panel-card">
        <template #header>
          <div class="panel-toolbar">
            <div>
              <h3 class="panel-title">系统状态</h3>
              <p class="panel-desc">关键依赖状态和当前使用边界</p>
            </div>
            <el-tag :type="health.ok ? 'success' : 'danger'" effect="light">
              {{ health.ok ? "正常" : "异常" }}
            </el-tag>
          </div>
        </template>

        <div class="stat-grid">
          <article class="stat-box">
            <strong>服务名</strong>
            <p>{{ health.service || "douyin-curation-assistant-server" }}</p>
          </article>
          <article class="stat-box">
            <strong>SQLite</strong>
            <p>{{ health.database?.label || "unknown" }}</p>
          </article>
          <article class="stat-box">
            <strong>前端来源</strong>
            <p>{{ health.clientOrigin || "-" }}</p>
          </article>
        </div>

        <el-alert
          title="当前优先级"
          type="info"
          show-icon
          :closable="false"
          description="如果待分析作品多，优先补评论分析；如果作品已经选定，直接在作品页执行互动动作。"
          style="margin-top: 14px"
        />

        <el-alert
          title="当前边界"
          type="warning"
          show-icon
          :closable="false"
          description="本版本聚焦采集、分析、作者筛选和直接互动，不再使用审核队列、评论模板、识别词库和动作规则。"
          style="margin-top: 10px"
        />
      </el-card>
    </section>

    <section class="page-grid two">
      <el-card class="panel-card">
        <template #header>
          <h3 class="panel-title">已覆盖能力</h3>
        </template>
        <el-timeline>
          <el-timeline-item>关键词维护、手动采集、连续采集</el-timeline-item>
          <el-timeline-item>评论分析、词云与高赞评论提取</el-timeline-item>
          <el-timeline-item>候选作者聚合、评分、人工审核</el-timeline-item>
          <el-timeline-item>候选作品库 / 推荐作品库直接互动执行</el-timeline-item>
        </el-timeline>
      </el-card>

      <el-card class="panel-card">
        <template #header>
          <h3 class="panel-title">建议使用顺序</h3>
        </template>
        <el-timeline>
          <el-timeline-item>先在「关键词中心」确认采集与浏览器验证</el-timeline-item>
          <el-timeline-item>再到「候选作品库」挑选高价值内容并分析</el-timeline-item>
          <el-timeline-item>也可以在「推荐作品库」直接处理推荐流作品</el-timeline-item>
          <el-timeline-item>最后在作品详情里直接执行点赞、收藏、关注或评论</el-timeline-item>
        </el-timeline>
      </el-card>
    </section>
  </AppShell>
</template>

<script setup>
import { onMounted, reactive } from "vue";
import { useRouter } from "vue-router";
import AppShell from "../components/layout/AppShell.vue";
import MetricCard from "../components/cards/MetricCard.vue";
import { api } from "../services/api.js";

const router = useRouter();

const dashboard = reactive({
  keywords: 0,
  works: 0,
  analyzedWorks: 0,
  creatorCandidates: 0,
  recommendWorks: 0,
  downloads: 0,
});

const health = reactive({
  ok: false,
  service: "",
  clientOrigin: "",
  database: {
    label: "",
  },
});

function go(path) {
  router.push(path);
}

onMounted(async () => {
  try {
    const [dashboardResponse, healthResponse] = await Promise.all([
      api.getDashboard(),
      api.getHealth(),
    ]);

    Object.assign(dashboard, dashboardResponse.data);
    Object.assign(health, healthResponse);
  } catch (error) {
    console.error(error);
  }
});
</script>
