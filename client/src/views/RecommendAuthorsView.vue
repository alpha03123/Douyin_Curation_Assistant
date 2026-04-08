<template>
  <AppShell>
    <template #header>
      <section class="hero-panel">
        <p class="hero-panel__kicker">Recommend Authors</p>
        <div class="hero-panel__main">
          <div>
            <h2 class="hero-panel__title">推荐作者库</h2>
            <p class="hero-panel__desc">
              独立沉淀推荐流里被动监听到的作者画像、粉丝数据、作品样本和时间快照。
            </p>
          </div>
          <div class="hero-panel__stats">
            <el-tag type="primary">作者 {{ authors.length }}</el-tag>
            <el-tag :type="selectedAuthor ? 'success' : 'info'">
              {{ selectedAuthor?.authorNickname || selectedAuthor?.authorKey || "未选择" }}
            </el-tag>
          </div>
        </div>
      </section>
    </template>

    <el-card class="panel-card">
      <template #header>
        <div class="panel-toolbar">
          <div>
            <h3 class="panel-title">筛选条件</h3>
            <p class="panel-desc">支持按昵称、简介、粉丝数、作品数和被推荐次数筛选推荐作者。</p>
          </div>
          <el-button @click="loadAuthors">刷新列表</el-button>
        </div>
      </template>

      <el-form label-position="top">
        <el-row :gutter="12">
          <el-col :xs="24" :sm="12" :md="8" :lg="6">
            <el-form-item label="关键词">
              <el-input v-model="filters.keyword" clearable placeholder="昵称、简介、authorKey、unique_id" />
            </el-form-item>
          </el-col>
          <el-col :xs="12" :sm="12" :md="8" :lg="4">
            <el-form-item label="最少粉丝">
              <el-input-number v-model="filters.minFollowerCount" :min="0" />
            </el-form-item>
          </el-col>
          <el-col :xs="12" :sm="12" :md="8" :lg="4">
            <el-form-item label="最少作品">
              <el-input-number v-model="filters.minAwemeCount" :min="0" />
            </el-form-item>
          </el-col>
          <el-col :xs="12" :sm="12" :md="8" :lg="4">
            <el-form-item label="最少被推荐作品数">
              <el-input-number v-model="filters.minSeenWorkCount" :min="0" />
            </el-form-item>
          </el-col>
          <el-col :xs="12" :sm="12" :md="8" :lg="4">
            <el-form-item label="排序字段">
              <el-select v-model="filters.sortBy">
                <el-option label="最近监听" value="lastSeenAt" />
                <el-option label="粉丝数" value="followerCount" />
                <el-option label="作品数" value="awemeCount" />
                <el-option label="被赞总数" value="totalFavorited" />
                <el-option label="被推荐作品数" value="seenWorkCount" />
                <el-option label="被推荐曝光数" value="seenExposureCount" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :xs="12" :sm="12" :md="8" :lg="3">
            <el-form-item label="方向">
              <el-select v-model="filters.sortOrder">
                <el-option label="desc" value="desc" />
                <el-option label="asc" value="asc" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :xs="12" :sm="12" :md="8" :lg="3">
            <el-form-item label="数量">
              <el-input-number v-model="filters.limit" :min="1" :max="100" />
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
              <h3 class="panel-title">推荐作者列表</h3>
              <p class="panel-desc">点击行查看作者详情、样本作品和快照记录。</p>
            </div>
          </div>
        </template>

        <el-table
          :data="authors"
          stripe
          highlight-current-row
          row-key="_id"
          max-height="720"
          @row-click="selectAuthor"
        >
          <el-table-column label="作者" min-width="240">
            <template #default="{ row }">
              <div style="display: flex; align-items: center; gap: 10px">
                <div class="avatar-thumb">
                  <img v-if="row.authorAvatar" :src="row.authorAvatar" :alt="row.authorNickname || row.authorKey" />
                </div>
                <div>
                  <p class="item-title" style="font-size: 15px">{{ row.authorNickname || row.authorKey }}</p>
                  <p class="item-subtitle">作品 {{ row.seenWorkCount || 0 }} · 曝光 {{ row.seenExposureCount || 0 }}</p>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="核心数据" min-width="220">
            <template #default="{ row }">
              <div class="data-line">
                <span>粉 {{ row.followerCount || 0 }}</span>
                <span>关 {{ row.followingCount || 0 }}</span>
                <span>作 {{ row.awemeCount || 0 }}</span>
              </div>
              <div class="data-line">
                <span>赞总 {{ row.totalFavorited || 0 }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="最近进入推荐" min-width="170">
            <template #default="{ row }">{{ formatDate(row.lastSeenAt) }}</template>
          </el-table-column>
        </el-table>

        <el-empty v-if="authors.length === 0" description="还没有推荐作者，先去推荐流采集页启动监听" />
      </el-card>

      <el-card class="panel-card">
        <template #header>
          <div class="panel-toolbar">
            <div>
              <h3 class="panel-title">作者详情</h3>
              <p class="panel-desc">查看作者画像、样本作品和历史快照。</p>
            </div>
          </div>
        </template>

        <el-empty v-if="!selectedDetail" description="从左侧选择一位推荐作者查看详情" />

        <div v-else class="page-stack list-scroll">
          <div class="split-item">
            <div class="avatar-thumb" style="width: 72px; height: 72px; flex-basis: 72px">
              <img
                v-if="selectedDetail.author?.authorAvatar"
                :src="selectedDetail.author.authorAvatar"
                :alt="selectedDetail.author.authorNickname || selectedDetail.author.authorKey"
              />
            </div>
            <div>
              <h4 class="item-title">{{ selectedDetail.author?.authorNickname || selectedDetail.author?.authorKey }}</h4>
              <p class="item-subtitle">{{ selectedDetail.author?.authorSignature || "暂无作者简介" }}</p>
            </div>
          </div>

          <div class="stat-grid">
            <article class="stat-box"><strong>粉丝</strong><p>{{ selectedDetail.author?.followerCount || 0 }}</p></article>
            <article class="stat-box"><strong>关注</strong><p>{{ selectedDetail.author?.followingCount || 0 }}</p></article>
            <article class="stat-box"><strong>作品</strong><p>{{ selectedDetail.author?.awemeCount || 0 }}</p></article>
            <article class="stat-box"><strong>被推荐作品</strong><p>{{ selectedDetail.author?.seenWorkCount || 0 }}</p></article>
          </div>

          <el-card shadow="never">
            <template #header>作者基础信息</template>
            <div class="page-stack">
              <p><strong>authorKey：</strong>{{ selectedDetail.author?.authorKey || "-" }}</p>
              <p><strong>UID：</strong>{{ selectedDetail.author?.authorUid || "-" }}</p>
              <p><strong>unique_id：</strong>{{ selectedDetail.author?.authorUniqueId || "-" }}</p>
              <p><strong>短号：</strong>{{ selectedDetail.author?.authorShortId || "-" }}</p>
              <p><strong>sec_uid：</strong>{{ selectedDetail.author?.authorSecUid || "-" }}</p>
              <p><strong>认证文案：</strong>{{ selectedDetail.author?.authorCustomVerify || "-" }}</p>
              <p><strong>企业认证：</strong>{{ selectedDetail.author?.authorEnterpriseVerifyReason || "-" }}</p>
              <p><strong>认证类型：</strong>{{ selectedDetail.author?.authorVerificationType ?? "-" }}</p>
              <p><strong>年龄：</strong>{{ selectedDetail.author?.userAge ?? "-" }}</p>
              <p><strong>性别：</strong>{{ selectedDetail.author?.gender || "-" }}</p>
              <p><strong>IP 归属地：</strong>{{ selectedDetail.author?.ipLocation || "-" }}</p>
              <p><strong>国家/省市：</strong>{{ [selectedDetail.author?.country, selectedDetail.author?.province, selectedDetail.author?.city, selectedDetail.author?.district].filter(Boolean).join(" / ") || "-" }}</p>
              <p><strong>最近进入推荐：</strong>{{ formatDate(selectedDetail.author?.lastSeenAt) }}</p>
            </div>
          </el-card>

          <el-card shadow="never">
            <template #header>高频话题</template>
            <div v-if="selectedDetail.author?.topTopics?.length" class="word-cloud">
              <el-tag
                v-for="item in selectedDetail.author.topTopics"
                :key="`${item.word}-${item.count}`"
                type="primary"
                effect="light"
              >
                {{ item.word }} · {{ item.count }}
              </el-tag>
            </div>
            <el-empty v-else description="暂无高频话题" />
          </el-card>

          <el-card shadow="never">
            <template #header>高频关键词</template>
            <div v-if="selectedDetail.author?.topKeywords?.length" class="word-cloud">
              <el-tag
                v-for="item in selectedDetail.author.topKeywords"
                :key="`${item.word}-${item.count}`"
              >
                {{ item.word }} · {{ item.count }}
              </el-tag>
            </div>
            <el-empty v-else description="暂无高频关键词" />
          </el-card>

          <el-card shadow="never">
            <template #header>样本作品</template>
            <el-empty v-if="!selectedDetail.works?.length" description="暂无样本作品" />
            <div v-else class="page-stack">
              <el-card v-for="work in selectedDetail.works.slice(0, 6)" :key="work._id" shadow="never">
                <div class="panel-toolbar">
                  <strong>{{ work.title || work.awemeId }}</strong>
                  <el-tag size="small">被刷到 {{ work.seenCount || 0 }} 次</el-tag>
                </div>
                <p class="item-subtitle">
                  {{ formatDate(work.lastSeenAt) }} · 粉丝 {{ work.followerCount || 0 }}
                </p>
              </el-card>
            </div>
          </el-card>

          <el-card shadow="never">
            <template #header>作者快照</template>
            <el-empty v-if="!selectedDetail.snapshots?.length" description="暂无作者快照" />
            <div v-else class="page-stack">
              <el-card v-for="item in selectedDetail.snapshots.slice(0, 8)" :key="item._id" shadow="never">
                <div class="panel-toolbar">
                  <strong>{{ formatDate(item.capturedAt) }}</strong>
                  <el-tag size="small">run {{ item.runId?.slice?.(0, 8) || "-" }}</el-tag>
                </div>
                <p class="item-subtitle">
                  粉丝 {{ item.followerCount || 0 }} · 关注 {{ item.followingCount || 0 }} · 作品 {{ item.awemeCount || 0 }}
                </p>
              </el-card>
            </div>
          </el-card>
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

const authors = ref([]);
const selectedAuthor = ref(null);
const selectedDetail = ref(null);

const filters = reactive({
  keyword: "",
  minFollowerCount: 0,
  minAwemeCount: 0,
  minSeenWorkCount: 0,
  sortBy: "lastSeenAt",
  sortOrder: "desc",
  limit: 30,
});

const notice = reactive({
  type: "info",
  title: "",
  message: "",
});

function setNotice(type, title, message) {
  notice.type = type;
  notice.title = title;
  notice.message = message;
  ElMessage({ type: type === "error" ? "error" : type, message: `${title}：${message}` });
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN");
}

async function loadAuthors() {
  const response = await api.getRecommendAuthors({
    keyword: filters.keyword,
    minFollowerCount: filters.minFollowerCount || "",
    minAwemeCount: filters.minAwemeCount || "",
    minSeenWorkCount: filters.minSeenWorkCount || "",
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder,
    limit: filters.limit,
  });

  authors.value = response.data;
  if (!selectedAuthor.value && authors.value.length > 0) {
    await selectAuthor(authors.value[0]);
    return;
  }

  if (selectedAuthor.value) {
    const matched = authors.value.find((item) => item._id === selectedAuthor.value._id);
    if (matched) {
      await selectAuthor(matched);
      return;
    }
  }

  if (authors.value.length === 0) {
    selectedAuthor.value = null;
    selectedDetail.value = null;
  }
}

async function selectAuthor(item) {
  selectedAuthor.value = item;
  try {
    const response = await api.getRecommendAuthorDetail(item._id);
    selectedDetail.value = response.data;
  } catch (error) {
    selectedDetail.value = null;
    setNotice("error", "详情加载失败", error.message || "无法读取推荐作者详情");
  }
}

watch(
  () => [
    filters.keyword,
    filters.minFollowerCount,
    filters.minAwemeCount,
    filters.minSeenWorkCount,
    filters.sortBy,
    filters.sortOrder,
    filters.limit,
  ],
  async () => {
    try {
      await loadAuthors();
    } catch (error) {
      console.error(error);
    }
  }
);

onMounted(async () => {
  try {
    await loadAuthors();
  } catch (error) {
    setNotice("error", "加载失败", error.message || "推荐作者加载失败");
  }
});
</script>
