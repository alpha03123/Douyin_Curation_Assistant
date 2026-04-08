<template>
  <AppShell>
    <template #header>
      <section class="hero-panel">
        <p class="hero-panel__kicker">Recommend Works</p>
        <div class="hero-panel__main">
          <div>
            <h2 class="hero-panel__title">推荐作品库</h2>
            <p class="hero-panel__desc">
              推荐流作品现在也可以直接执行点赞、收藏、关注和评论，不再先走审核任务。
            </p>
          </div>
          <div class="hero-panel__stats">
            <el-tag type="primary">作品 {{ works.length }}</el-tag>
            <el-tag :type="selectedRows.length ? 'warning' : 'info'">已选择 {{ selectedRows.length }}</el-tag>
            <el-tag :type="selectedDetail ? 'success' : 'info'">
              {{ selectedDetail?.work?.title || selectedDetail?.work?.awemeId || "未选择" }}
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
              <h3 class="panel-title">筛选条件</h3>
              <p class="panel-desc">按标题、作者、互动和时间区间筛选推荐作品。</p>
            </div>
            <div class="panel-toolbar__actions">
              <el-button @click="loadWorks">刷新列表</el-button>
              <el-button :loading="exporting" @click="exportCurrentWorks">导出当前筛选</el-button>
            </div>
          </div>
        </template>

        <el-form label-position="top">
          <el-row :gutter="12">
            <el-col :xs="24" :sm="12" :md="8" :lg="6">
              <el-form-item label="关键词">
                <el-input v-model="filters.keyword" clearable placeholder="标题、描述、话题、作者" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12" :md="8" :lg="6">
              <el-form-item label="作者关键词">
                <el-input v-model="filters.authorKeyword" clearable placeholder="昵称、unique_id、sec_uid、简介" />
              </el-form-item>
            </el-col>
            <el-col :xs="12" :sm="12" :md="8" :lg="4">
              <el-form-item label="作品类型">
                <el-select v-model="filters.workType" clearable>
                  <el-option label="video" value="video" />
                  <el-option label="image" value="image" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :xs="12" :sm="12" :md="8" :lg="4">
              <el-form-item label="排序字段">
                <el-select v-model="filters.sortBy">
                  <el-option label="最近监听" value="lastSeenAt" />
                  <el-option label="发布时间" value="publishAt" />
                  <el-option label="点赞数" value="diggCount" />
                  <el-option label="评论数" value="commentCount" />
                  <el-option label="粉丝数" value="followerCount" />
                  <el-option label="被刷到次数" value="seenCount" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :xs="12" :sm="12" :md="8" :lg="3">
              <el-form-item label="排序方向">
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
            <el-col :xs="12" :sm="12" :md="8" :lg="3">
              <el-form-item label="最少粉丝">
                <el-input-number v-model="filters.minFollowerCount" :min="0" />
              </el-form-item>
            </el-col>
            <el-col :xs="12" :sm="12" :md="8" :lg="3">
              <el-form-item label="最少点赞">
                <el-input-number v-model="filters.minDiggCount" :min="0" />
              </el-form-item>
            </el-col>
            <el-col :xs="12" :sm="12" :md="8" :lg="3">
              <el-form-item label="最少评论">
                <el-input-number v-model="filters.minCommentCount" :min="0" />
              </el-form-item>
            </el-col>
            <el-col :xs="12" :sm="12" :md="8" :lg="3">
              <el-form-item label="最少收藏">
                <el-input-number v-model="filters.minCollectCount" :min="0" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12" :md="8" :lg="6">
              <el-form-item label="最近监听时间">
                <el-date-picker
                  v-model="filters.listenRange"
                  type="datetimerange"
                  start-placeholder="开始时间"
                  end-placeholder="结束时间"
                  value-format="YYYY-MM-DDTHH:mm:ss.SSS[Z]"
                />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12" :md="8" :lg="6">
              <el-form-item label="作品发布时间">
                <el-date-picker
                  v-model="filters.publishRange"
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

      <el-card v-if="selectedRows.length" class="panel-card">
        <template #header>
          <div class="panel-toolbar">
            <div>
              <h3 class="panel-title">批量操作</h3>
              <p class="panel-desc">当前已选择 {{ selectedRows.length }} 条推荐作品。</p>
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
        show-icon
        :closable="false"
      />

      <section class="page-grid workspace">
        <el-card class="panel-card">
          <template #header>
            <div class="panel-toolbar">
              <div>
                <h3 class="panel-title">推荐作品列表</h3>
                <p class="panel-desc">支持下载、详情查看、直接互动和批量删除。</p>
              </div>
            </div>
          </template>

          <el-table
            ref="worksTableRef"
            :data="works"
            stripe
            highlight-current-row
            row-key="_id"
            max-height="720"
            @row-click="selectWork"
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
                    <p class="item-subtitle">{{ row.authorNickname || "作者待补充" }} · 被刷到 {{ row.seenCount || 0 }} 次</p>
                  </div>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="互动" min-width="220">
              <template #default="{ row }">
                <div class="data-line">
                  <span>赞 {{ row.diggCount || 0 }}</span>
                  <span>评 {{ row.commentCount || 0 }}</span>
                  <span>藏 {{ row.collectCount || 0 }}</span>
                </div>
                <div class="data-line">
                  <span>粉 {{ row.followerCount || 0 }}</span>
                  <span>时长 {{ Math.round(row.durationSeconds || 0) }}s</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="发布时间" min-width="170">
              <template #default="{ row }">{{ formatDate(row.publishAt) }}</template>
            </el-table-column>
            <el-table-column label="最近监听" min-width="170">
              <template #default="{ row }">{{ formatDate(row.lastSeenAt) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="240" fixed="right">
              <template #default="{ row }">
                <div class="item-actions">
                  <el-button size="small" @click.stop="openWorkUrl(row.workUrl)">打开作品</el-button>
                  <el-button size="small" type="warning" @click.stop="openDownloadDialog(row)">下载</el-button>
                  <el-button size="small" @click.stop="selectWork(row)">详情</el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>

          <el-empty v-if="works.length === 0" description="还没有推荐作品，先去推荐流采集页启动监听" />
        </el-card>

        <el-card class="panel-card">
          <template #header>
            <div class="panel-toolbar">
              <div>
                <h3 class="panel-title">推荐作品详情</h3>
                <p class="panel-desc">这里直接对推荐作品执行互动，不再先生成审核任务。</p>
              </div>
            </div>
          </template>

          <el-empty v-if="!selectedDetail" description="从左侧选择一条推荐作品查看详情" />

          <div v-else class="page-stack list-scroll">
            <div class="split-item">
              <div class="cover-thumb">
                <img
                  v-if="getWorkImage(selectedDetail.work)"
                  :src="getWorkImage(selectedDetail.work)"
                  :alt="selectedDetail.work?.title || selectedDetail.work?.awemeId"
                />
              </div>
              <div>
                <h4 class="item-title">{{ selectedDetail.work?.title || selectedDetail.work?.awemeId }}</h4>
                <p class="item-subtitle">{{ selectedDetail.work?.authorNickname || "作者待补充" }}</p>
              </div>
            </div>

            <div class="stat-grid">
              <article class="stat-box"><strong>被刷到次数</strong><p>{{ selectedDetail.work?.seenCount || 0 }}</p></article>
              <article class="stat-box"><strong>粉丝数</strong><p>{{ selectedDetail.work?.followerCount || 0 }}</p></article>
              <article class="stat-box"><strong>作品数</strong><p>{{ selectedDetail.work?.awemeCount || 0 }}</p></article>
              <article class="stat-box"><strong>评论数</strong><p>{{ selectedDetail.work?.commentCount || 0 }}</p></article>
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
                  :loading="directActionLoading === `${selectedDetail.work?._id}:like`"
                  :disabled="Boolean(directActionLoading)"
                  @click="executeSelectedWorkAction('like')"
                >
                  点赞
                </el-button>
                <el-button
                  :loading="directActionLoading === `${selectedDetail.work?._id}:collect`"
                  :disabled="Boolean(directActionLoading)"
                  @click="executeSelectedWorkAction('collect')"
                >
                  收藏
                </el-button>
                <el-button
                  :loading="directActionLoading === `${selectedDetail.work?._id}:follow`"
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
                  :loading="directActionLoading === `${selectedDetail.work?._id}:comment`"
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

            <el-collapse v-model="expandedPanels">
              <el-collapse-item title="作品基础信息" name="work">
                <div class="page-stack">
                  <p><strong>作品类型：</strong>{{ selectedDetail.work?.workType || "-" }}</p>
                  <p><strong>作品地址：</strong>{{ selectedDetail.work?.workUrl || "-" }}</p>
                  <p><strong>描述：</strong>{{ selectedDetail.work?.desc || "-" }}</p>
                  <p><strong>点赞：</strong>{{ selectedDetail.work?.diggCount || 0 }}</p>
                  <p><strong>评论：</strong>{{ selectedDetail.work?.commentCount || 0 }}</p>
                  <p><strong>收藏：</strong>{{ selectedDetail.work?.collectCount || 0 }}</p>
                  <p><strong>分享：</strong>{{ selectedDetail.work?.shareCount || 0 }}</p>
                  <p><strong>时长：</strong>{{ Math.round(selectedDetail.work?.durationSeconds || 0) }}s</p>
                  <p><strong>话题：</strong>{{ (selectedDetail.work?.topics || []).join(" / ") || "-" }}</p>
                  <p><strong>发布时间：</strong>{{ formatDate(selectedDetail.work?.publishAt) }}</p>
                </div>
              </el-collapse-item>

              <el-collapse-item title="作者信息" name="author">
                <div class="page-stack">
                  <p><strong>昵称：</strong>{{ selectedDetail.work?.authorNickname || "-" }}</p>
                  <p><strong>short_id：</strong>{{ selectedDetail.work?.authorShortId || "-" }}</p>
                  <p><strong>unique_id：</strong>{{ selectedDetail.work?.authorUniqueId || "-" }}</p>
                  <p><strong>sec_uid：</strong>{{ selectedDetail.work?.authorSecUid || "-" }}</p>
                  <p><strong>UID：</strong>{{ selectedDetail.work?.authorUid || "-" }}</p>
                  <p><strong>简介：</strong>{{ selectedDetail.work?.authorSignature || "-" }}</p>
                  <p><strong>关注：</strong>{{ selectedDetail.work?.followingCount || 0 }}</p>
                  <p><strong>粉丝：</strong>{{ selectedDetail.work?.followerCount || 0 }}</p>
                  <p><strong>获赞总数：</strong>{{ selectedDetail.work?.totalFavorited || 0 }}</p>
                  <p><strong>主页：</strong>{{ selectedDetail.work?.userUrl || "-" }}</p>
                </div>
              </el-collapse-item>

              <el-collapse-item title="评论词云" name="word-cloud">
                <div v-if="wordCloud.length > 0" class="word-cloud">
                  <el-tag
                    v-for="item in wordCloud"
                    :key="`${item.word}-${item.count}`"
                    size="small"
                    type="primary"
                    effect="light"
                  >
                    {{ item.word }} · {{ item.count }}
                  </el-tag>
                </div>
                <el-empty v-else description="暂无词云数据" />
              </el-collapse-item>

              <el-collapse-item title="高赞评论" name="top-comments">
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
              </el-collapse-item>

              <el-collapse-item title="曝光历史" name="exposures">
                <el-empty v-if="!selectedDetail.exposures?.length" description="暂无曝光记录" />
                <div v-else class="page-stack">
                  <el-card v-for="item in selectedDetail.exposures" :key="item._id" shadow="never">
                    <div class="panel-toolbar">
                      <strong>{{ formatDate(item.exposedAt) }}</strong>
                      <el-tag size="small">{{ item.transitionMode || item.advanceMethod || "unknown" }}</el-tag>
                    </div>
                    <p class="item-subtitle">
                      {{ item.skipReason ? `跳过原因：${item.skipReason}` : `分析状态：${item.analysisStatus || "pending"}` }}
                    </p>
                  </el-card>
                </div>
              </el-collapse-item>
            </el-collapse>
          </div>
        </el-card>
      </section>

      <el-dialog v-model="downloadDialogOpen" width="620px" title="下载推荐作品" destroy-on-close>
        <div v-if="downloadWork" class="page-stack">
          <el-alert
            type="info"
            :closable="false"
            show-icon
            :title="downloadWork.title || downloadWork.desc || downloadWork.awemeId"
            :description="`${downloadWork.authorNickname || '未知作者'} · ${downloadWork.workType || 'unknown'}`"
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

      <el-dialog v-model="batchDeleteDialogOpen" width="520px" title="批量删除推荐作品" destroy-on-close>
        <div class="page-stack">
          <el-alert
            type="warning"
            :closable="false"
            show-icon
            title="这会删除推荐作品及其关联推荐数据"
            :description="`将删除 ${selectedRows.length} 条推荐作品，并同步清理推荐评论、推荐分析、曝光记录和作者快照。`"
          />
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
const selectedWork = ref(null);
const selectedDetail = ref(null);
const selectedRows = ref([]);
const exporting = ref(false);
const batchDeleteDialogOpen = ref(false);
const batchDeleting = ref(false);
const expandedPanels = ref([]);
const downloadDialogOpen = ref(false);
const downloadSubmitting = ref(false);
const downloadWork = ref(null);
const directActionLoading = ref("");
const directActionHeadless = ref(false);
const directCommentDraft = ref("");

const filters = reactive({
  keyword: "",
  authorKeyword: "",
  workType: "",
  sortBy: "lastSeenAt",
  sortOrder: "desc",
  limit: 30,
  minFollowerCount: 0,
  minDiggCount: 0,
  minCommentCount: 0,
  minCollectCount: 0,
  listenRange: [],
  publishRange: [],
});

const downloadForm = reactive({
  assets: [],
  removeWatermark: true,
});

const notice = reactive({
  type: "info",
  title: "",
  message: "",
});

const wordCloud = computed(() => selectedDetail.value?.analysis?.wordCloud || []);
const topComments = computed(() => selectedDetail.value?.comments || []);

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

function getWorkImage(work) {
  if (!work) return "";
  if (work.videoCover) return work.videoCover;
  if (Array.isArray(work.images) && work.images.length > 0) return work.images[0];
  if (work.authorAvatar) return work.authorAvatar;
  return "";
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

function openDownloadDialog(item) {
  downloadWork.value = item;
  downloadForm.assets =
    item.workType === "image"
      ? ["images", "cover", "music", "metadata"]
      : ["video", "cover", "music", "metadata"];
  downloadForm.removeWatermark = item.workType !== "image";
  downloadDialogOpen.value = true;
}

function escapeCsvCell(value) {
  const safeValue = String(value ?? "");
  return `"${safeValue.replace(/"/g, '""')}"`;
}

function downloadTextFile(fileName, content, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob(["\uFEFF", content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function exportCurrentWorks() {
  if (!works.value.length) {
    setNotice("warning", "无法导出", "当前筛选结果为空");
    return;
  }

  exporting.value = true;
  try {
    const headers = [
      "awemeId",
      "title",
      "desc",
      "workType",
      "authorNickname",
      "authorUniqueId",
      "authorSecUid",
      "authorShortId",
      "authorUid",
      "authorSignature",
      "followerCount",
      "diggCount",
      "commentCount",
      "collectCount",
      "shareCount",
      "seenCount",
      "publishAt",
      "lastSeenAt",
    ];
    const rows = works.value.map((item) => [
      item.awemeId,
      item.title,
      item.desc,
      item.workType,
      item.authorNickname,
      item.authorUniqueId,
      item.authorSecUid,
      item.authorShortId,
      item.authorUid,
      item.authorSignature,
      item.followerCount,
      item.diggCount,
      item.commentCount,
      item.collectCount,
      item.shareCount,
      item.seenCount,
      item.publishAt,
      item.lastSeenAt,
    ]);
    const csvContent = [
      headers.map((item) => escapeCsvCell(item)).join(","),
      ...rows.map((row) => row.map((item) => escapeCsvCell(item)).join(",")),
    ].join("\r\n");

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadTextFile(`recommend-works-${timestamp}.csv`, csvContent, "text/csv;charset=utf-8");
    setNotice("success", "导出完成", `已导出 ${works.value.length} 条推荐作品`);
  } catch (error) {
    setNotice("error", "导出失败", error.message || "推荐作品导出失败");
  } finally {
    exporting.value = false;
  }
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
  const work = selectedDetail.value?.work;
  if (!work?._id) {
    setNotice("warning", "未选择作品", "请先从左侧选择一个推荐作品");
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
    const response = await api.executeRecommendWorkDirectAction(work._id, {
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
  const response = await api.getRecommendWorks({
    keyword: filters.keyword,
    authorKeyword: filters.authorKeyword,
    workType: filters.workType,
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder,
    limit: filters.limit,
    minFollowerCount: filters.minFollowerCount || "",
    minDiggCount: filters.minDiggCount || "",
    minCommentCount: filters.minCommentCount || "",
    minCollectCount: filters.minCollectCount || "",
    dateFrom: filters.listenRange?.[0] || "",
    dateTo: filters.listenRange?.[1] || "",
    publishFrom: filters.publishRange?.[0] || "",
    publishTo: filters.publishRange?.[1] || "",
    includeAnalysis: true,
  });

  works.value = response.data;
  clearSelection();

  if (!selectedWork.value && works.value.length > 0) {
    await selectWork(works.value[0]);
    return;
  }

  if (selectedWork.value) {
    const matched = works.value.find((item) => item._id === selectedWork.value._id);
    if (matched) {
      await selectWork(matched);
      return;
    }
  }

  if (works.value.length === 0) {
    selectedWork.value = null;
    selectedDetail.value = null;
  }
}

async function selectWork(item) {
  selectedWork.value = item;
  try {
    const response = await api.getRecommendWorkDetail(item._id);
    selectedDetail.value = response.data;
    directCommentDraft.value = "";
    expandedPanels.value = [];
  } catch (error) {
    selectedDetail.value = null;
    setNotice("error", "详情加载失败", error.message || "无法读取推荐作品详情");
  }
}

async function submitDownloadTask() {
  if (!downloadWork.value) return;

  downloadSubmitting.value = true;
  try {
    await api.createDownloadTask({
      sourceUrl: downloadWork.value.workUrl,
      assets: [...downloadForm.assets],
      removeWatermark: downloadForm.removeWatermark,
    });
    setNotice("success", "下载任务已创建", "推荐作品下载任务已加入队列");
    downloadDialogOpen.value = false;
  } catch (error) {
    setNotice("error", "创建下载失败", error.message || "下载任务创建失败");
  } finally {
    downloadSubmitting.value = false;
  }
}

async function submitBatchDelete() {
  if (!selectedRows.value.length) return;

  batchDeleting.value = true;
  try {
    const response = await api.batchDeleteRecommendWorks({
      workIds: selectedRows.value.map((item) => item._id),
    });

    if (
      selectedDetail.value?.work?._id &&
      selectedRows.value.some((item) => item._id === selectedDetail.value.work._id)
    ) {
      selectedWork.value = null;
      selectedDetail.value = null;
    }

    batchDeleteDialogOpen.value = false;
    setNotice(
      "success",
      "批量删除完成",
      `已删除推荐作品 ${response.data.deletedWorks} 条，评论 ${response.data.deletedComments} 条，曝光 ${response.data.deletedExposures} 条`
    );
    await loadWorks();
  } catch (error) {
    setNotice("error", "批量删除失败", error.message || "推荐作品批量删除失败");
  } finally {
    batchDeleting.value = false;
  }
}

watch(
  () => [
    filters.keyword,
    filters.authorKeyword,
    filters.workType,
    filters.sortBy,
    filters.sortOrder,
    filters.limit,
    filters.minFollowerCount,
    filters.minDiggCount,
    filters.minCommentCount,
    filters.minCollectCount,
    JSON.stringify(filters.listenRange),
    JSON.stringify(filters.publishRange),
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
    setNotice("error", "加载失败", error.message || "推荐作品加载失败");
  }
});
</script>
