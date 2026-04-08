<template>
  <AppShell>
    <template #header>
      <section class="hero-panel">
        <p class="hero-panel__kicker">Candidate Works</p>
        <div class="hero-panel__main">
          <div>
            <h2 class="hero-panel__title">候选作品库</h2>
            <p class="hero-panel__desc">
              在这里直接完成筛选、分析、下载和互动执行，不再经过规则任务生成和审核队列。
            </p>
          </div>
          <div class="hero-panel__stats">
            <el-tag type="primary">作品 {{ works.length }}</el-tag>
            <el-tag :type="selectedRows.length ? 'warning' : 'info'">已选择 {{ selectedRows.length }}</el-tag>
            <el-tag :type="selectedAnalysis ? 'success' : 'info'">
              {{ selectedAnalysis?.work?.title || selectedAnalysis?.work?.awemeId || "未打开详情" }}
            </el-tag>
          </div>
        </div>
      </section>
    </template>

    <section class="page-stack">
      <el-card class="panel-card">
        <template #header>
          <div class="panel-toolbar">
            <div>
              <h3 class="panel-title">筛选与分析</h3>
              <p class="panel-desc">优先筛出高互动作品，再决定是否直接点赞、收藏、关注或评论。</p>
            </div>
            <div class="panel-toolbar__actions">
              <el-button @click="loadWorks">刷新列表</el-button>
            </div>
          </div>
        </template>

        <el-form label-position="top">
          <el-row :gutter="12">
            <el-col :xs="24" :sm="12" :md="8" :lg="6">
              <el-form-item label="关键词">
                <el-input v-model="filters.keyword" clearable placeholder="标题、描述、作者、关键词来源" />
              </el-form-item>
            </el-col>
            <el-col :xs="12" :sm="12" :md="8" :lg="4">
              <el-form-item label="状态">
                <el-select v-model="filters.status" clearable>
                  <el-option label="new" value="new" />
                  <el-option label="reviewing" value="reviewing" />
                  <el-option label="approved" value="approved" />
                  <el-option label="archived" value="archived" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :xs="12" :sm="12" :md="8" :lg="4">
              <el-form-item label="来源">
                <el-select v-model="filters.sourceType" clearable>
                  <el-option label="关键词" value="keyword" />
                  <el-option label="推荐流" value="recommend" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :xs="12" :sm="12" :md="8" :lg="4">
              <el-form-item label="排序字段">
                <el-select v-model="filters.sortBy">
                  <el-option label="最近更新" value="updatedAt" />
                  <el-option label="点赞数" value="diggCount" />
                  <el-option label="评论数" value="commentCount" />
                  <el-option label="收藏数" value="collectCount" />
                  <el-option label="分享数" value="shareCount" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :xs="12" :sm="12" :md="8" :lg="4">
              <el-form-item label="排序方向">
                <el-select v-model="filters.sortOrder">
                  <el-option label="从高到低" value="desc" />
                  <el-option label="从低到高" value="asc" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :xs="12" :sm="12" :md="8" :lg="3">
              <el-form-item label="数量">
                <el-input-number v-model="filters.limit" :min="1" :max="100" />
              </el-form-item>
            </el-col>
            <el-col :xs="12" :sm="12" :md="8" :lg="3">
              <el-form-item label="抓评数量">
                <el-input-number v-model="filters.commentLimit" :min="5" :max="100" />
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>

        <div class="item-actions">
          <el-button type="primary" :loading="batchAnalyzing" @click="runBatchAnalysis">
            分析当前筛选结果
          </el-button>
        </div>
      </el-card>

      <el-card v-if="selectedRows.length" class="panel-card">
        <template #header>
          <div class="panel-toolbar">
            <div>
              <h3 class="panel-title">批量操作</h3>
              <p class="panel-desc">当前已选择 {{ selectedRows.length }} 条作品。</p>
            </div>
            <div class="panel-toolbar__actions">
              <el-button @click="clearSelection">清空选择</el-button>
              <el-button type="danger" @click="batchDeleteDialogOpen = true">批量删除</el-button>
            </div>
          </div>
        </template>
      </el-card>

      <el-alert
        v-if="notice.message"
        :title="notice.title || '状态通知'"
        :description="notice.message"
        :type="notice.type || 'info'"
        :closable="false"
        show-icon
      />

      <section class="page-grid workspace">
        <el-card class="panel-card">
          <template #header>
            <div class="panel-toolbar">
              <div>
                <h3 class="panel-title">作品列表</h3>
                <p class="panel-desc">支持分析、下载、打开详情和批量删除。</p>
              </div>
            </div>
          </template>

          <el-table
            ref="worksTableRef"
            :data="works"
            stripe
            max-height="720"
            row-key="_id"
            @selection-change="handleSelectionChange"
          >
            <el-table-column type="selection" width="48" />
            <el-table-column label="作品" min-width="260" show-overflow-tooltip>
              <template #default="{ row }">
                <div style="display: flex; align-items: center; gap: 12px">
                  <div class="cover-thumb" style="width: 56px; height: 72px; flex: 0 0 56px">
                    <img v-if="getWorkImage(row)" :src="getWorkImage(row)" :alt="row.title || row.awemeId" />
                  </div>
                  <div style="min-width: 0">
                    <p class="item-title" style="font-size: 15px">{{ row.title || row.desc || row.awemeId }}</p>
                    <p class="item-subtitle">{{ row.authorName || "作者待补充" }} · {{ row.keywordSource || "未记录关键词" }}</p>
                  </div>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="类型" width="90">
              <template #default="{ row }">
                <el-tag size="small">{{ row.workType || "unknown" }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="互动" min-width="180">
              <template #default="{ row }">
                <div class="data-line">
                  <span>赞 {{ row.diggCount || 0 }}</span>
                  <span>评 {{ row.commentCount || 0 }}</span>
                  <span>藏 {{ row.collectCount || 0 }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="分析" width="100">
              <template #default="{ row }">
                <el-tag v-if="row.analysisSummary" size="small" type="success">
                  {{ row.analysisSummary.totalScore || 0 }}
                </el-tag>
                <span v-else class="item-subtitle">未分析</span>
              </template>
            </el-table-column>
            <el-table-column label="更新时间" min-width="170">
              <template #default="{ row }">{{ formatDate(row.updatedAt) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="280" fixed="right">
              <template #default="{ row }">
                <div class="item-actions">
                  <el-button v-if="row.workUrl" size="small" @click="openWorkUrl(row.workUrl)">打开作品</el-button>
                  <el-button size="small" type="warning" @click="openDownloadDialog(row)">下载</el-button>
                  <el-button size="small" type="primary" :loading="analyzingWorkId === row._id" @click="analyzeWork(row)">
                    分析
                  </el-button>
                  <el-button size="small" @click="showAnalysis(row)">详情</el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>

          <el-empty v-if="works.length === 0" description="当前还没有候选作品，先去关键词中心采集" />
        </el-card>

        <el-card class="panel-card">
          <template #header>
            <div class="panel-toolbar">
              <div>
                <h3 class="panel-title">作品详情</h3>
                <p class="panel-desc">直接在当前作品上执行点赞、收藏、关注和评论。</p>
              </div>
            </div>
          </template>

          <el-empty v-if="!selectedAnalysis" description="在左侧点击详情或分析，打开作品详情" />

          <div v-else class="page-stack list-scroll">
            <div class="split-item">
              <div class="cover-thumb">
                <img
                  v-if="getWorkImage(selectedAnalysis.work)"
                  :src="getWorkImage(selectedAnalysis.work)"
                  :alt="selectedAnalysis.work?.title || selectedAnalysis.work?.awemeId"
                />
              </div>
              <div>
                <h4 class="item-title">{{ selectedAnalysis.work?.title || selectedAnalysis.work?.awemeId }}</h4>
                <p class="item-subtitle">{{ selectedAnalysis.work?.authorName || "作者待补充" }}</p>
              </div>
            </div>

            <div class="stat-grid">
              <article class="stat-box"><strong>总分</strong><p>{{ selectedAnalysis.analysis?.scores?.totalScore || 0 }}</p></article>
              <article class="stat-box"><strong>评论关键词分</strong><p>{{ selectedAnalysis.analysis?.scores?.commentKeywordScore || 0 }}</p></article>
              <article class="stat-box"><strong>高赞评论分</strong><p>{{ selectedAnalysis.analysis?.scores?.topCommentScore || 0 }}</p></article>
              <article class="stat-box"><strong>Top10 命中率</strong><p>{{ formatRatio(selectedAnalysis.analysis?.keywordHits?.top10KeywordHitRate) }}</p></article>
            </div>

            <el-card shadow="never">
              <template #header>
                <div class="panel-toolbar">
                  <div>
                    <strong>直接动作</strong>
                    <p class="panel-desc">点赞、收藏、关注可以一键执行；评论改成页内填写后发送。</p>
                  </div>
                  <div style="display: flex; align-items: center; gap: 8px">
                    <span class="item-subtitle">无界面</span>
                    <el-switch
                      v-model="directActionHeadless"
                      inline-prompt
                      active-text="是"
                      inactive-text="否"
                    />
                  </div>
                </div>
              </template>
              <div class="item-actions">
                <el-button
                  type="primary"
                  :loading="directActionLoading === `${selectedAnalysis.work?._id}:like`"
                  :disabled="Boolean(directActionLoading)"
                  @click="executeSelectedWorkAction('like')"
                >
                  点赞
                </el-button>
                <el-button
                  :loading="directActionLoading === `${selectedAnalysis.work?._id}:collect`"
                  :disabled="Boolean(directActionLoading)"
                  @click="executeSelectedWorkAction('collect')"
                >
                  收藏
                </el-button>
                <el-button
                  :loading="directActionLoading === `${selectedAnalysis.work?._id}:follow`"
                  :disabled="Boolean(directActionLoading)"
                  @click="executeSelectedWorkAction('follow')"
                >
                  关注
                </el-button>
              </div>
              <el-form-item label="直接评论" style="margin-top: 12px">
                <el-input
                  v-model="directCommentDraft"
                  type="textarea"
                  :rows="3"
                  resize="vertical"
                  placeholder="输入评论内容后直接发送"
                />
              </el-form-item>
              <div class="item-actions">
                <el-button
                  type="primary"
                  :loading="directActionLoading === `${selectedAnalysis.work?._id}:comment`"
                  :disabled="!directCommentDraft.trim() || Boolean(directActionLoading)"
                  @click="executeSelectedWorkAction('comment')"
                >
                  发送评论
                </el-button>
                <el-button :disabled="Boolean(directActionLoading)" @click="directCommentDraft = ''">
                  清空评论
                </el-button>
              </div>
              <p class="panel-desc">当前模式：{{ directActionHeadless ? "无界面" : "可视化" }}。</p>
            </el-card>

            <el-card shadow="never">
              <template #header>评论词云</template>
              <div v-if="wordCloud.length > 0" class="word-cloud">
                <el-tag v-for="item in wordCloud" :key="`${item.word}-${item.count}`" size="small" type="primary" effect="light">
                  {{ item.word }} · {{ item.count }}
                </el-tag>
              </div>
              <el-empty v-else description="暂无词云数据" />
            </el-card>

            <el-card shadow="never">
              <template #header>命中关键词</template>
              <div v-if="keywordHits.length > 0" class="word-cloud">
                <el-tag v-for="item in keywordHits" :key="`${item.word}-${item.count}`" size="small">
                  {{ item.word }} · {{ item.count }}
                </el-tag>
              </div>
              <el-empty v-else description="暂无命中记录" />
            </el-card>

            <el-card shadow="never">
              <template #header>高赞评论</template>
              <el-empty v-if="topComments.length === 0" description="暂无高赞评论" />
              <div v-else class="page-stack">
                <el-card v-for="item in topComments" :key="item.commentId" shadow="never">
                  <div class="panel-toolbar">
                    <strong>{{ item.authorName || "匿名评论" }}</strong>
                    <el-tag size="small">点赞 {{ item.diggCount || 0 }}</el-tag>
                  </div>
                  <p>{{ item.text }}</p>
                </el-card>
              </div>
            </el-card>
          </div>
        </el-card>
      </section>

      <el-dialog v-model="downloadDialogOpen" width="620px" title="下载当前作品" destroy-on-close>
        <div v-if="downloadWork" class="page-stack">
          <el-alert
            type="info"
            :closable="false"
            show-icon
            :title="downloadWork.title || downloadWork.desc || downloadWork.awemeId"
            :description="`${downloadWork.authorName || '未知作者'} · ${downloadWork.workType || 'unknown'}`"
          />
          <el-form label-position="top">
            <el-form-item label="下载内容">
              <el-checkbox-group v-model="downloadForm.assets">
                <el-checkbox v-if="downloadWork.workType !== 'image'" label="video">视频</el-checkbox>
                <el-checkbox v-if="downloadWork.workType === 'image'" label="images">图集</el-checkbox>
                <el-checkbox label="cover">封面</el-checkbox>
                <el-checkbox label="music">原声</el-checkbox>
                <el-checkbox label="metadata">元数据</el-checkbox>
              </el-checkbox-group>
            </el-form-item>
            <el-form-item label="去水印">
              <el-switch
                v-model="downloadForm.removeWatermark"
                :disabled="downloadWork.workType === 'image'"
                inline-prompt
                active-text="开启"
                inactive-text="关闭"
              />
            </el-form-item>
          </el-form>
        </div>
        <template #footer>
          <div class="item-actions">
            <el-button @click="downloadDialogOpen = false">取消</el-button>
            <el-button type="primary" :loading="downloadSubmitting" @click="submitDownloadTask">创建下载任务</el-button>
          </div>
        </template>
      </el-dialog>

      <el-dialog v-model="batchDeleteDialogOpen" width="520px" title="批量删除作品" destroy-on-close>
        <div class="page-stack">
          <el-alert
            type="warning"
            :closable="false"
            show-icon
            title="这会删除作品及其关联数据"
            :description="`将删除 ${selectedRows.length} 条作品，并同步清理评论分析、评论明细、动作任务、执行日志和下载记录。`"
          />
          <el-checkbox v-model="deleteForm.removeDownloadedFiles">同时删除关联下载文件</el-checkbox>
        </div>
        <template #footer>
          <div class="item-actions">
            <el-button @click="batchDeleteDialogOpen = false">取消</el-button>
            <el-button type="danger" :loading="batchDeleting" @click="submitBatchDelete">确认删除</el-button>
          </div>
        </template>
      </el-dialog>
    </section>
  </AppShell>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import AppShell from "../components/layout/AppShell.vue";
import { api } from "../services/api.js";

const worksTableRef = ref(null);
const works = ref([]);
const selectedAnalysis = ref(null);
const selectedRows = ref([]);
const analyzingWorkId = ref("");
const batchAnalyzing = ref(false);
const directActionLoading = ref("");
const directActionHeadless = ref(false);
const directCommentDraft = ref("");
const downloadDialogOpen = ref(false);
const downloadSubmitting = ref(false);
const downloadWork = ref(null);
const batchDeleteDialogOpen = ref(false);
const batchDeleting = ref(false);

const filters = reactive({
  keyword: "",
  status: "",
  sourceType: "",
  sortBy: "updatedAt",
  sortOrder: "desc",
  limit: 24,
  commentLimit: 30,
});

const downloadForm = reactive({
  assets: [],
  removeWatermark: true,
});

const deleteForm = reactive({
  removeDownloadedFiles: false,
});

const notice = reactive({
  type: "info",
  title: "",
  message: "",
});

const wordCloud = computed(() => selectedAnalysis.value?.analysis?.wordCloud || []);
const topComments = computed(() => selectedAnalysis.value?.comments || []);
const keywordHits = computed(() => {
  const analysis = selectedAnalysis.value?.analysis;
  if (!analysis?.keywordHits) return [];
  return [...(analysis.keywordHits.target || []), ...(analysis.keywordHits.strong || [])];
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

function getWorkImage(work) {
  if (!work) return "";
  if (work.videoCover) return work.videoCover;
  if (Array.isArray(work.images) && work.images.length > 0) return work.images[0];
  if (work.authorAvatar) return work.authorAvatar;
  return "";
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN");
}

function formatRatio(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function handleSelectionChange(rows) {
  selectedRows.value = rows;
}

function clearSelection() {
  selectedRows.value = [];
  worksTableRef.value?.clearSelection?.();
}

function openWorkUrl(url) {
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

function buildDirectActionError(error) {
  if (error.code === "DOUYIN_RUNTIME_LOGIN_REQUIRED") {
    const profileLabel = error.details?.profileLabel || "当前浏览器会话";
    const keptOpenMessage =
      error.details?.browserKeptOpen && !directActionHeadless.value
        ? " 已保留可视化浏览器窗口，请在窗口里完成登录或拖动验证后重试。"
        : "";
    return {
      title: `${profileLabel} 未登录`,
      message: `${profileLabel} 当前没有可用登录态，或被验证码/风控拦截。${keptOpenMessage}`.trim(),
    };
  }

  if (error.code === "DY_COOKIES_MISSING") {
    return {
      title: "缺少可用登录态",
      message: "当前没有可用的抖音 Cookie 或浏览器会话，请先准备登录态。",
    };
  }

  if (error.code === "DIRECT_COMMENT_TEXT_REQUIRED") {
    return {
      title: "评论内容为空",
      message: "请输入评论内容后再执行评论动作。",
    };
  }

  return {
    title: "动作执行失败",
    message: error.message || "当前动作执行失败",
  };
}

async function confirmDirectAction(actionType, work) {
  const actionLabelMap = {
    like: "点赞",
    collect: "收藏",
    follow: "关注",
  };
  const actionLabel = actionLabelMap[actionType];
  if (!actionLabel) {
    return true;
  }

  const workTitle = work?.title || work?.awemeId || "当前作品";
  try {
    await ElMessageBox.confirm(
      `确认要对“${workTitle}”执行${actionLabel}吗？`,
      "动作确认",
      {
        type: "warning",
        confirmButtonText: `确认${actionLabel}`,
        cancelButtonText: "取消",
      }
    );
    return true;
  } catch {
    return false;
  }
}

function extractDirectActionMessage(response) {
  const execution = response?.data?.executionResult || {};
  if (execution.skipped) {
    return execution.reason || "动作已处于完成状态";
  }

  const modeLabel = directActionHeadless.value ? "无界面" : "可视化";
  return execution.actionType
    ? `${execution.actionType} 已以${modeLabel}模式提交执行`
    : `动作已以${modeLabel}模式提交执行`;
}

async function executeSelectedWorkAction(actionType) {
  const work = selectedAnalysis.value?.work;
  if (!work?._id) {
    setNotice("warning", "未选择作品", "请先打开一个候选作品详情");
    return;
  }

  if (["like", "collect", "follow"].includes(actionType)) {
    const confirmed = await confirmDirectAction(actionType, work);
    if (!confirmed) {
      return;
    }
  }

  let commentText = "";
  if (actionType === "comment") {
    commentText = directCommentDraft.value.trim();
    if (!commentText) {
      setNotice("warning", "评论内容为空", "请输入评论内容后再发送");
      return;
    }
  }

  directActionLoading.value = `${work._id}:${actionType}`;
  try {
    const response = await api.executeWorkDirectAction(work._id, {
      actionType,
      commentText,
      headless: directActionHeadless.value,
    });
    if (actionType === "comment") {
      directCommentDraft.value = "";
    }
    setNotice("success", "动作已执行", extractDirectActionMessage(response));
  } catch (error) {
    const actionError = buildDirectActionError(error);
    setNotice("error", actionError.title, actionError.message);
  } finally {
    directActionLoading.value = "";
  }
}

async function loadWorks() {
  const response = await api.getWorks({
    keyword: filters.keyword,
    status: filters.status,
    sourceType: filters.sourceType,
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder,
    limit: filters.limit,
    includeAnalysis: true,
  });
  works.value = response.data;
  clearSelection();
}

function openDownloadDialog(item) {
  downloadWork.value = item;
  downloadForm.assets =
    item.workType === "image"
      ? ["images", "cover", "music", "metadata"]
      : ["video", "cover", "music", "metadata"];
  downloadForm.removeWatermark = item.workType !== "image";
  downloadDialogOpen.value = true;
}

async function submitDownloadTask() {
  if (!downloadWork.value) return;

  downloadSubmitting.value = true;
  try {
    const response = await api.createDownloadTask({
      workId: downloadWork.value._id,
      assets: [...downloadForm.assets],
      removeWatermark: downloadForm.removeWatermark,
    });
    setNotice("success", "下载任务已创建", `任务 ${response.data._id} 已进入后台执行`);
    downloadDialogOpen.value = false;
  } catch (error) {
    setNotice("error", "创建下载任务失败", error.message || "请稍后重试");
  } finally {
    downloadSubmitting.value = false;
  }
}

async function submitBatchDelete() {
  if (!selectedRows.value.length) return;

  batchDeleting.value = true;
  try {
    const response = await api.batchDeleteWorks({
      workIds: selectedRows.value.map((item) => item._id),
      removeDownloadedFiles: deleteForm.removeDownloadedFiles,
    });

    if (
      selectedAnalysis.value?.work?._id &&
      selectedRows.value.some((item) => item._id === selectedAnalysis.value.work._id)
    ) {
      selectedAnalysis.value = null;
    }

    batchDeleteDialogOpen.value = false;
    setNotice(
      "success",
      "批量删除完成",
      `删除作品 ${response.data.deletedWorks} 条，评论 ${response.data.deletedComments} 条，任务 ${response.data.deletedActionTasks} 条`
    );
    await loadWorks();
  } catch (error) {
    setNotice("error", "批量删除失败", error.message || "请稍后重试");
  } finally {
    batchDeleting.value = false;
  }
}

async function analyzeWork(item) {
  analyzingWorkId.value = item._id;
  try {
    const response = await api.runWorkAnalysis(item._id, {
      commentLimit: filters.commentLimit,
    });
    selectedAnalysis.value = response.data;
    setNotice("success", "分析完成", "评论抓取和分析已经完成");
    await loadWorks();
  } catch (error) {
    setNotice("error", "分析失败", error.message || "评论分析失败");
  } finally {
    analyzingWorkId.value = "";
  }
}

async function showAnalysis(item) {
  try {
    const response = await api.getWorkAnalysis(item._id);
    selectedAnalysis.value = response.data;
  } catch (error) {
    setNotice("error", "加载失败", error.message || "分析详情加载失败");
  }
}

async function runBatchAnalysis() {
  batchAnalyzing.value = true;
  try {
    const response = await api.runBatchAnalysis({
      limit: filters.limit,
      keyword: filters.keyword,
      commentLimit: filters.commentLimit,
    });
    const successCount = response.data.filter((item) => item.success).length;
    setNotice("success", "批量分析完成", `本次成功分析 ${successCount} 条作品`);
    await loadWorks();
  } catch (error) {
    setNotice("error", "批量分析失败", error.message || "批量分析失败");
  } finally {
    batchAnalyzing.value = false;
  }
}

watch(
  () => [
    filters.keyword,
    filters.status,
    filters.sourceType,
    filters.sortBy,
    filters.sortOrder,
    filters.limit,
  ],
  async () => {
    try {
      await loadWorks();
    } catch (error) {
      console.error(error);
    }
  }
);

onMounted(async () => {
  try {
    await loadWorks();
  } catch (error) {
    setNotice("error", "加载失败", error.message || "作品列表加载失败");
  }
});
</script>
