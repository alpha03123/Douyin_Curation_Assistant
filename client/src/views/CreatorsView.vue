<template>
  <AppShell>
    <template #header>
      <section class="hero-panel">
        <p class="hero-panel__kicker">Creator Candidates</p>
        <div class="hero-panel__main">
          <div>
            <h2 class="hero-panel__title">候选作者库</h2>
            <p class="hero-panel__desc">
              从已分析作品中聚合作者画像，结合评分与来源关键词做人工筛选。
            </p>
          </div>
          <div class="hero-panel__stats">
            <el-tag type="primary">候选作者 {{ creators.length }}</el-tag>
            <el-tag :type="selectedCreator ? 'success' : 'info'">
              {{ selectedCreator?.nickname || selectedCreator?.creatorKey || "未选择" }}
            </el-tag>
          </div>
        </div>
      </section>
    </template>

    <el-card class="panel-card">
      <template #header>
        <div class="panel-toolbar">
          <div>
            <h3 class="panel-title">筛选与重建</h3>
            <p class="panel-desc">关键词搜索支持匹配昵称、简介、标识和来源关键词。</p>
          </div>
          <div class="panel-toolbar__actions">
            <el-button @click="loadCreators">刷新列表</el-button>
            <el-button type="primary" :loading="rebuilding" @click="rebuildCreators">
              从已分析作品重建作者库
            </el-button>
          </div>
        </div>
      </template>

      <el-form label-position="top">
        <el-row :gutter="12">
          <el-col :xs="24" :sm="12" :md="8" :lg="6">
            <el-form-item label="关键词模糊搜索">
              <el-input v-model="filters.keyword" clearable placeholder="例如：气质、甜妹、氧气感" />
            </el-form-item>
          </el-col>
          <el-col :xs="12" :sm="12" :md="8" :lg="4">
            <el-form-item label="审核状态">
              <el-select v-model="filters.reviewStatus" clearable>
                <el-option label="new" value="new" />
                <el-option label="reviewing" value="reviewing" />
                <el-option label="approved" value="approved" />
                <el-option label="rejected" value="rejected" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :xs="12" :sm="12" :md="8" :lg="4">
            <el-form-item label="候选等级">
              <el-select v-model="filters.candidateLevel" clearable>
                <el-option label="high" value="high" />
                <el-option label="medium" value="medium" />
                <el-option label="low" value="low" />
                <el-option label="unknown" value="unknown" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :xs="12" :sm="12" :md="8" :lg="3">
            <el-form-item label="加载数量">
              <el-input-number v-model="filters.limit" :min="1" :max="100" />
            </el-form-item>
          </el-col>
          <el-col :xs="12" :sm="12" :md="8" :lg="3">
            <el-form-item label="重建范围">
              <el-input-number v-model="filters.rebuildLimit" :min="1" :max="200" />
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

    <section class="page-grid workspace">
      <el-card class="panel-card">
        <template #header>
          <div class="panel-toolbar">
            <div>
              <h3 class="panel-title">作者列表</h3>
              <p class="panel-desc">点击行可在右侧查看完整作者画像。</p>
            </div>
            <el-tag type="primary">{{ creators.length }} 位</el-tag>
          </div>
        </template>

        <el-table
          :data="creators"
          stripe
          highlight-current-row
          :current-row-key="selectedCreator?._id"
          row-key="_id"
          @row-click="selectCreator"
          max-height="700"
        >
          <el-table-column label="作者" min-width="220">
            <template #default="{ row }">
              <div style="display: flex; align-items: center; gap: 10px">
                <div class="avatar-thumb">
                  <img v-if="row.authorAvatar" :src="row.authorAvatar" :alt="row.nickname || row.creatorKey" />
                </div>
                <div>
                  <p class="item-title" style="font-size: 15px">{{ row.nickname || row.creatorKey }}</p>
                  <p class="item-subtitle">样本作品 {{ row.analyzedWorkCount || 0 }} · 评论 {{ row.sampledCommentCount || 0 }}</p>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="候选等级" width="120">
            <template #default="{ row }">
              <el-tag :type="levelType(row.candidateLevel)" effect="light">{{ row.candidateLevel || "unknown" }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="审核状态" width="120">
            <template #default="{ row }">
              <el-tag :type="reviewType(row.reviewStatus)" effect="light">{{ row.reviewStatus || "new" }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="totalScore" label="总分" width="90" />
          <el-table-column label="来源关键词" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">
              {{ (row.keywordSources || []).join("、") || "-" }}
            </template>
          </el-table-column>
        </el-table>

        <el-empty v-if="creators.length === 0" description="还没有候选作者，先去作品库补分析后重建" />
      </el-card>

      <el-card class="panel-card">
        <template #header>
          <div class="panel-toolbar">
            <div>
              <h3 class="panel-title">作者详情</h3>
              <p class="panel-desc">固定查看当前作者的分数、样本作品和高赞评论。</p>
            </div>
          </div>
        </template>

        <el-empty v-if="!selectedCreator" description="从左侧选择一位候选作者查看详情" />

        <div v-else class="page-stack list-scroll">
          <div class="split-item">
            <div class="avatar-thumb" style="width: 72px; height: 72px; flex-basis: 72px">
              <img
                v-if="selectedCreator.authorAvatar"
                :src="selectedCreator.authorAvatar"
                :alt="selectedCreator.nickname || selectedCreator.creatorKey"
              />
            </div>
            <div>
              <h4 class="item-title">{{ selectedCreator.nickname || selectedCreator.creatorKey }}</h4>
              <p class="item-subtitle">{{ selectedCreator.userDesc || "暂无作者简介" }}</p>
            </div>
          </div>

          <div class="stat-grid">
            <article class="stat-box">
              <strong>总分</strong>
              <p>{{ selectedCreator.totalScore || 0 }}</p>
            </article>
            <article class="stat-box">
              <strong>候选等级</strong>
              <p>{{ selectedCreator.candidateLevel || "unknown" }}</p>
            </article>
            <article class="stat-box">
              <strong>审核状态</strong>
              <p>{{ selectedCreator.reviewStatus || "new" }}</p>
            </article>
            <article class="stat-box">
              <strong>来源关键词</strong>
              <p>{{ selectedCreator.keywordSources?.length || 0 }}</p>
            </article>
          </div>

          <el-card shadow="never">
            <template #header>来源关键词</template>
            <div v-if="selectedCreator.keywordSources?.length" class="inline-tags">
              <el-tag v-for="keyword in selectedCreator.keywordSources" :key="keyword">{{ keyword }}</el-tag>
            </div>
            <el-empty v-else description="暂无来源关键词" />
          </el-card>

          <el-card shadow="never">
            <template #header>高频词</template>
            <div v-if="selectedCreator.topKeywords?.length" class="word-cloud">
              <el-tag
                v-for="keyword in selectedCreator.topKeywords.slice(0, 14)"
                :key="`${keyword.word}-${keyword.count}`"
                type="primary"
                effect="light"
              >
                {{ keyword.word }} · {{ keyword.count }}
              </el-tag>
            </div>
            <el-empty v-else description="暂无聚合词频" />
          </el-card>

          <el-card shadow="never">
            <template #header>代表作品</template>
            <el-empty v-if="!selectedCreator.sampleWorks?.length" description="暂无代表作品" />
            <div v-else class="page-stack">
              <el-card
                v-for="work in selectedCreator.sampleWorks.slice(0, 4)"
                :key="work.awemeId"
                shadow="never"
              >
                <div class="panel-toolbar">
                  <strong>{{ work.title || work.awemeId }}</strong>
                  <el-tag size="small">总分 {{ work.totalScore || 0 }}</el-tag>
                </div>
                <p class="item-subtitle">{{ work.keywordSource || "未记录来源关键词" }}</p>
              </el-card>
            </div>
          </el-card>

          <el-card shadow="never">
            <template #header>高赞评论样本</template>
            <el-empty v-if="!selectedCreator.topComments?.length" description="暂无高赞评论样本" />
            <div v-else class="page-stack">
              <el-card
                v-for="comment in selectedCreator.topComments.slice(0, 4)"
                :key="comment.commentId"
                shadow="never"
              >
                <div class="panel-toolbar">
                  <strong>{{ comment.authorName || "匿名评论" }}</strong>
                  <el-tag size="small">点赞 {{ comment.diggCount || 0 }}</el-tag>
                </div>
                <p>{{ comment.text }}</p>
              </el-card>
            </div>
          </el-card>

          <div class="item-actions">
            <el-button v-if="selectedCreator.userUrl" @click="openAuthorUrl(selectedCreator.userUrl)">
              打开作者主页
            </el-button>
            <el-button @click="setReviewStatus(selectedCreator, 'reviewing')">标记 reviewing</el-button>
            <el-button type="primary" @click="setReviewStatus(selectedCreator, 'approved')">通过</el-button>
            <el-button type="danger" @click="setReviewStatus(selectedCreator, 'rejected')">驳回</el-button>
          </div>
        </div>
      </el-card>
    </section>
  </AppShell>
</template>

<script setup>
import { onMounted, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import AppShell from "../components/layout/AppShell.vue";
import { api } from "../services/api.js";

const creators = ref([]);
const selectedCreator = ref(null);
const rebuilding = ref(false);

const notice = reactive({
  type: "info",
  title: "",
  message: "",
});

const filters = reactive({
  keyword: "",
  reviewStatus: "",
  candidateLevel: "",
  limit: 30,
  rebuildLimit: 50,
});

function levelType(level) {
  if (level === "high") return "success";
  if (level === "medium") return "warning";
  if (level === "low") return "danger";
  return "info";
}

function reviewType(status) {
  if (status === "approved") return "success";
  if (status === "reviewing") return "warning";
  if (status === "rejected") return "danger";
  return "info";
}

function setNotice(type, title, message) {
  notice.type = type;
  notice.title = title;
  notice.message = message;
  ElMessage({ type: type === "error" ? "error" : type, message: `${title}：${message}` });
}

function syncSelectedCreator() {
  if (!creators.value.length) {
    selectedCreator.value = null;
    return;
  }

  if (!selectedCreator.value) {
    selectedCreator.value = creators.value[0];
    return;
  }

  const matched = creators.value.find(
    (creator) => creator._id === selectedCreator.value._id
  );
  selectedCreator.value = matched || creators.value[0];
}

function openAuthorUrl(url) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function selectCreator(item) {
  selectedCreator.value = item;
}

async function loadCreators() {
  const response = await api.getCreatorCandidates({
    keyword: filters.keyword,
    reviewStatus: filters.reviewStatus,
    candidateLevel: filters.candidateLevel,
    limit: filters.limit,
  });
  creators.value = response.data;
  syncSelectedCreator();
}

async function rebuildCreators() {
  rebuilding.value = true;
  notice.message = "";

  try {
    const response = await api.rebuildCreatorCandidates({
      limit: filters.rebuildLimit,
      keyword: filters.keyword,
    });
    creators.value = response.data;
    syncSelectedCreator();
    setNotice("success", "重建完成", `作者库已重建，共 ${response.data.length} 位候选作者`);
  } catch (error) {
    setNotice("error", "重建失败", error.message || "作者库重建失败");
  } finally {
    rebuilding.value = false;
  }
}

async function setReviewStatus(item, reviewStatus) {
  try {
    const response = await api.updateCreatorCandidate(item._id, { reviewStatus });
    const index = creators.value.findIndex((creator) => creator._id === item._id);
    if (index !== -1) {
      creators.value[index] = response.data;
    }
    syncSelectedCreator();
    setNotice(
      "success",
      "状态已更新",
      `已更新作者“${item.nickname || item.creatorKey}”的审核状态`
    );
  } catch (error) {
    setNotice("error", "更新失败", error.message || "状态更新失败");
  }
}

watch(
  () => [
    filters.keyword,
    filters.reviewStatus,
    filters.candidateLevel,
    filters.limit,
  ],
  async () => {
    try {
      await loadCreators();
    } catch (error) {
      console.error(error);
    }
  }
);

onMounted(async () => {
  try {
    await loadCreators();
  } catch (error) {
    setNotice("error", "加载失败", error.message || "候选作者加载失败");
  }
});
</script>
