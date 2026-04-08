<template>
  <AppShell>
    <template #header>
      <section class="hero-panel">
        <p class="hero-panel__kicker">Recommend Insights</p>
        <div class="hero-panel__main">
          <div>
            <h2 class="hero-panel__title">推荐分析台</h2>
            <p class="hero-panel__desc">
              这版分析台只围绕 5 个动作模块展开：高赞作品榜、高频话题、全评论词云、高赞评论样本、话题详情。
            </p>
          </div>
          <div class="hero-panel__stats">
            <el-tag type="primary">作品 {{ insights.overview.workCount }}</el-tag>
            <el-tag type="success">作者 {{ insights.overview.authorCount }}</el-tag>
            <el-tag type="warning">已分析 {{ insights.overview.analyzedWorkCount }}</el-tag>
          </div>
        </div>
      </section>
    </template>

    <el-card class="panel-card">
      <template #header>
        <div class="panel-toolbar">
          <div>
            <h3 class="panel-title">分析范围</h3>
            <p class="panel-desc">按推荐流监听时间聚合高赞作品、话题和评论信号。</p>
          </div>
          <el-button :loading="loading" @click="loadInsights">刷新分析</el-button>
        </div>
      </template>

      <el-form label-position="top">
        <el-row :gutter="12">
          <el-col :xs="24" :sm="16" :md="12" :lg="10">
            <el-form-item label="监听时间范围">
              <el-date-picker
                v-model="filters.dateRange"
                type="datetimerange"
                start-placeholder="开始时间"
                end-placeholder="结束时间"
                value-format="YYYY-MM-DDTHH:mm:ss.SSS[Z]"
              />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
    </el-card>

    <el-alert
      v-if="notice.message"
      :title="notice.title || '状态通知'"
      :description="notice.message"
      :type="notice.type || 'info'"
      show-icon
      :closable="false"
    />

    <section class="page-grid three">
      <MetricCard label="推荐作品" :value="insights.overview.workCount" note="进入本次分析范围的推荐作品数" />
      <MetricCard label="推荐作者" :value="insights.overview.authorCount" note="本次分析覆盖到的作者画像数" />
      <MetricCard label="已分析作品" :value="insights.overview.analyzedWorkCount" note="已经抓评并完成评论分析" />
      <MetricCard label="高频话题" :value="insights.overview.topicCount" note="本次筛出的话题数量" />
      <MetricCard label="评论样本" :value="insights.overview.commentSampleCount" note="参与统计的评论样本量" />
      <MetricCard label="高赞作品榜" :value="insights.topLikedWorks.length" note="当前进入榜单的作品条数" />
    </section>

    <section class="page-grid two">
      <el-card class="panel-card">
        <template #header>
          <div class="panel-toolbar">
            <div>
              <h3 class="panel-title">高赞作品榜</h3>
              <p class="panel-desc">默认按点赞数排序，同时带出评论、收藏、重复曝光和分析分。</p>
            </div>
          </div>
        </template>

        <el-table :data="insights.topLikedWorks" stripe max-height="520">
          <el-table-column label="作品" min-width="240" show-overflow-tooltip>
            <template #default="{ row }">
              <div>
                <p class="item-title">{{ row.title || row.awemeId }}</p>
                <p class="item-subtitle">{{ row.authorNickname || "作者待补充" }}</p>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="diggCount" label="点赞" width="90" />
          <el-table-column prop="commentCount" label="评论" width="90" />
          <el-table-column prop="collectCount" label="收藏" width="90" />
          <el-table-column prop="seenCount" label="被推次数" width="100" />
          <el-table-column prop="latestAnalysisScore" label="分析分" width="90" />
          <el-table-column label="最近出现" min-width="160">
            <template #default="{ row }">{{ formatDate(row.lastSeenAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="110" fixed="right">
            <template #default="{ row }">
              <el-button size="small" :disabled="!row.workUrl" @click="openWorkUrl(row.workUrl)">
                打开
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <el-empty v-if="!insights.topLikedWorks.length" description="当前范围内还没有高赞作品数据" />
      </el-card>

      <el-card class="panel-card">
        <template #header>
          <div class="panel-toolbar">
            <div>
              <h3 class="panel-title">高频话题</h3>
              <p class="panel-desc">点击任意话题，右侧详情会切到该话题的代表作品、代表作者和评论信号。</p>
            </div>
            <el-tag :type="selectedTopicDetail ? 'success' : 'info'">
              {{ selectedTopicDetail?.topic || "未选中话题" }}
            </el-tag>
          </div>
        </template>

        <el-table
          :data="insights.topTopics"
          stripe
          highlight-current-row
          row-key="topic"
          max-height="520"
          @row-click="selectTopic"
        >
          <el-table-column prop="topic" label="话题" min-width="180" show-overflow-tooltip />
          <el-table-column prop="workCount" label="作品数" width="90" />
          <el-table-column prop="authorCount" label="作者数" width="90" />
          <el-table-column prop="averageDiggCount" label="平均赞" width="100" />
          <el-table-column prop="totalSeenCount" label="被推次数" width="100" />
          <el-table-column label="最近出现" min-width="160">
            <template #default="{ row }">{{ formatDate(row.lastSeenAt) }}</template>
          </el-table-column>
        </el-table>

        <el-empty v-if="!insights.topTopics.length" description="当前范围内还没有高频话题" />
      </el-card>
    </section>

    <section class="page-grid two">
      <el-card class="panel-card">
        <template #header>
          <div class="panel-toolbar">
            <div>
              <h3 class="panel-title">全评论词云</h3>
              <p class="panel-desc">这里统计的是当前范围内“已分析推荐作品”的评论词云总和。</p>
            </div>
          </div>
        </template>

        <div v-if="insights.globalCommentWordCloud.length" class="word-cloud">
          <el-tag
            v-for="item in insights.globalCommentWordCloud"
            :key="`${item.word}-${item.count}`"
            type="success"
            effect="light"
          >
            {{ item.word }} · {{ item.count }} · {{ item.workCount }} 作品
          </el-tag>
        </div>
        <el-empty v-else description="当前范围内还没有评论词云数据" />
      </el-card>

      <el-card class="panel-card">
        <template #header>
          <div class="panel-toolbar">
            <div>
              <h3 class="panel-title">高赞评论样本</h3>
              <p class="panel-desc">优先看高赞评论在怎么说，方便你判断评论切入方式。</p>
            </div>
          </div>
        </template>

        <el-empty v-if="!insights.topCommentSamples.length" description="当前范围内还没有高赞评论样本" />

        <div v-else class="page-stack list-scroll" style="max-height: 520px">
          <el-card v-for="item in insights.topCommentSamples" :key="`${item.workId}-${item.commentId}`" shadow="never">
            <div class="panel-toolbar">
              <strong>{{ item.authorName || "匿名评论" }}</strong>
              <el-tag size="small">点赞 {{ item.diggCount || 0 }}</el-tag>
            </div>
            <p>{{ item.text }}</p>
            <p class="item-subtitle">
              {{ item.workTitle || item.workId }} · {{ item.workAuthorNickname || "作者待补充" }}
            </p>
            <div v-if="item.workTopics?.length" class="word-cloud">
              <el-tag v-for="topic in item.workTopics" :key="`${item.commentId}-${topic}`" size="small" effect="light">
                {{ topic }}
              </el-tag>
            </div>
          </el-card>
        </div>
      </el-card>
    </section>

    <el-card class="panel-card">
      <template #header>
        <div class="panel-toolbar">
          <div>
            <h3 class="panel-title">话题详情</h3>
            <p class="panel-desc">聚焦当前选中话题的代表作品、代表作者和评论信号。</p>
          </div>
          <el-tag :type="selectedTopicDetail ? 'primary' : 'info'">
            {{ selectedTopicDetail?.topic || "未选中话题" }}
          </el-tag>
        </div>
      </template>

      <el-empty v-if="!selectedTopicDetail" description="先从上方高频话题列表中选择一个话题" />

      <div v-else class="page-stack">
        <div class="stat-grid">
          <article class="stat-box">
            <strong>作品数</strong>
            <p>{{ selectedTopicDetail.workCount || 0 }}</p>
          </article>
          <article class="stat-box">
            <strong>作者数</strong>
            <p>{{ selectedTopicDetail.authorCount || 0 }}</p>
          </article>
          <article class="stat-box">
            <strong>平均点赞</strong>
            <p>{{ selectedTopicDetail.averageDiggCount || 0 }}</p>
          </article>
          <article class="stat-box">
            <strong>最近出现</strong>
            <p>{{ formatDate(selectedTopicDetail.lastSeenAt) }}</p>
          </article>
        </div>

        <section class="page-grid two">
          <el-card class="panel-card" shadow="never">
            <template #header>
              <h3 class="panel-title">代表作品</h3>
            </template>
            <el-table :data="selectedTopicDetail.representativeWorks" stripe max-height="320">
              <el-table-column label="作品" min-width="220" show-overflow-tooltip>
                <template #default="{ row }">
                  <div>
                    <p class="item-title">{{ row.title || row.awemeId }}</p>
                    <p class="item-subtitle">{{ row.authorNickname || "作者待补充" }}</p>
                  </div>
                </template>
              </el-table-column>
              <el-table-column prop="diggCount" label="点赞" width="90" />
              <el-table-column prop="seenCount" label="被推" width="90" />
              <el-table-column prop="latestAnalysisScore" label="分析分" width="90" />
              <el-table-column label="操作" width="90" fixed="right">
                <template #default="{ row }">
                  <el-button size="small" :disabled="!row.workUrl" @click="openWorkUrl(row.workUrl)">
                    打开
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-card>

          <el-card class="panel-card" shadow="never">
            <template #header>
              <h3 class="panel-title">代表作者</h3>
            </template>
            <el-table :data="selectedTopicDetail.representativeAuthors" stripe max-height="320">
              <el-table-column prop="authorNickname" label="作者" min-width="180" show-overflow-tooltip />
              <el-table-column prop="topicWorkCount" label="话题作品" width="100" />
              <el-table-column prop="topicSeenCount" label="被推次数" width="100" />
              <el-table-column prop="followerCount" label="粉丝" width="100" />
            </el-table>
          </el-card>
        </section>

        <section class="page-grid two">
          <el-card class="panel-card" shadow="never">
            <template #header>
              <h3 class="panel-title">话题评论词云</h3>
            </template>
            <div v-if="selectedTopicDetail.commentWordCloud?.length" class="word-cloud">
              <el-tag
                v-for="item in selectedTopicDetail.commentWordCloud"
                :key="`${selectedTopicDetail.topic}-${item.word}`"
                type="success"
                effect="light"
              >
                {{ item.word }} · {{ item.count }}
              </el-tag>
            </div>
            <el-empty v-else description="当前话题还没有评论词云数据" />
          </el-card>

          <el-card class="panel-card" shadow="never">
            <template #header>
              <h3 class="panel-title">话题高赞评论</h3>
            </template>
            <el-empty v-if="!selectedTopicDetail.topCommentSamples?.length" description="当前话题还没有高赞评论样本" />
            <div v-else class="page-stack list-scroll" style="max-height: 320px">
              <el-card
                v-for="item in selectedTopicDetail.topCommentSamples"
                :key="`${selectedTopicDetail.topic}-${item.commentId}`"
                shadow="never"
              >
                <div class="panel-toolbar">
                  <strong>{{ item.authorName || "匿名评论" }}</strong>
                  <el-tag size="small">点赞 {{ item.diggCount || 0 }}</el-tag>
                </div>
                <p>{{ item.text }}</p>
                <p class="item-subtitle">{{ item.workTitle || item.workId }} · {{ item.workAuthorNickname || "作者待补充" }}</p>
              </el-card>
            </div>
          </el-card>
        </section>
      </div>
    </el-card>
  </AppShell>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import AppShell from "../components/layout/AppShell.vue";
import MetricCard from "../components/cards/MetricCard.vue";
import { api } from "../services/api.js";

const loading = ref(false);
const selectedTopic = ref("");

const filters = reactive({
  dateRange: [],
});

const notice = reactive({
  type: "info",
  title: "",
  message: "",
});

const insights = reactive({
  range: {
    dateFrom: null,
    dateTo: null,
  },
  overview: {
    workCount: 0,
    authorCount: 0,
    analyzedWorkCount: 0,
    topicCount: 0,
    commentSampleCount: 0,
  },
  topLikedWorks: [],
  topTopics: [],
  globalCommentWordCloud: [],
  topCommentSamples: [],
  topicDetails: [],
  defaultTopic: "",
});

const selectedTopicDetail = computed(() => {
  if (!selectedTopic.value) {
    return null;
  }

  return insights.topicDetails.find((item) => item.topic === selectedTopic.value) || null;
});

function setNotice(type, title, message) {
  notice.type = type;
  notice.title = title;
  notice.message = message;
  ElMessage({
    type: type === "error" ? "error" : type,
    message: `${title}: ${message}`,
  });
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN");
}

function openWorkUrl(url) {
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

function syncSelectedTopic() {
  const availableTopics = insights.topTopics.map((item) => item.topic).filter(Boolean);
  if (availableTopics.length === 0) {
    selectedTopic.value = "";
    return;
  }

  if (!availableTopics.includes(selectedTopic.value)) {
    selectedTopic.value = insights.defaultTopic || availableTopics[0];
  }
}

function selectTopic(row) {
  if (!row?.topic) {
    return;
  }

  selectedTopic.value = row.topic;
}

async function loadInsights() {
  loading.value = true;
  try {
    const response = await api.getRecommendInsights({
      dateFrom: filters.dateRange?.[0] || "",
      dateTo: filters.dateRange?.[1] || "",
    });
    Object.assign(insights, response.data);
    syncSelectedTopic();
  } catch (error) {
    setNotice("error", "分析加载失败", error.message || "无法读取推荐分析台数据");
  } finally {
    loading.value = false;
  }
}

watch(
  () => JSON.stringify(filters.dateRange),
  async () => {
    try {
      await loadInsights();
    } catch (error) {
      console.error(error);
    }
  }
);

onMounted(async () => {
  try {
    await loadInsights();
  } catch (error) {
    setNotice("error", "加载失败", error.message || "推荐分析台加载失败");
  }
});
</script>
