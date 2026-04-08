<template>
  <AppShell>
    <template #header>
      <section class="hero-panel">
        <p class="hero-panel__kicker">Recommend Feed</p>
        <div class="hero-panel__main">
          <div>
            <h2 class="hero-panel__title">推荐流采集</h2>
            <p class="hero-panel__desc">
              目标页固定为抖音推荐页。开启站内连播时优先等待页面自己切换，超时后兜底手动切下一条。
            </p>
          </div>
          <div class="hero-panel__stats">
            <el-tag :type="runStateTagType" effect="dark">
              {{ runStateLabel }}
            </el-tag>
            <el-tag :type="form.headless ? 'warning' : 'success'">
              {{ form.headless ? "无界面" : "显示浏览器" }}
            </el-tag>
            <el-tag type="primary">最近批次 {{ runs.length }}</el-tag>
          </div>
        </div>
      </section>
    </template>

    <section class="page-grid workspace">
      <div class="page-stack">
        <el-card class="panel-card">
          <template #header>
            <div class="panel-toolbar">
              <div>
                <h3 class="panel-title">运行控制</h3>
                <p class="panel-desc">先确认目标页和运行模式，再启动采集。</p>
              </div>
              <div class="panel-toolbar__actions">
                <el-button
                  :loading="preparingBrowser"
                  :disabled="preparingBrowser || status.running || runTransitionBusy"
                  @click="openBrowserSession"
                >
                  打开登录浏览器
                </el-button>
                <el-button
                  type="primary"
                  :loading="submitting && !status.running"
                  :disabled="runTransitionBusy || status.running"
                  @click="startRun"
                >
                  启动采集
                </el-button>
                <el-button
                  type="danger"
                  :loading="submitting && status.running"
                  :disabled="submitting || !status.running || status.isSettling"
                  @click="stopRun"
                >
                  停止采集
                </el-button>
              </div>
            </div>
          </template>

          <div class="stat-grid">
            <article class="stat-box">
              <strong>开始时间</strong>
              <p>{{ formatDate(status.startedAt) }}</p>
            </article>
            <article class="stat-box">
              <strong>最近心跳</strong>
              <p>{{ formatDate(status.lastHeartbeatAt) }}</p>
            </article>
            <article class="stat-box">
              <strong>曝光数</strong>
              <p>{{ status.totals.seenCount }}</p>
            </article>
            <article class="stat-box">
              <strong>直播跳过</strong>
              <p>{{ status.totals.liveSkippedCount }}</p>
            </article>
          </div>

          <el-form label-position="top" style="margin-top: 14px">
            <el-row :gutter="12">
              <el-col :xs="24" :sm="12" :md="8">
                <el-form-item label="推荐页地址">
                  <el-input v-model="form.targetUrl" />
                </el-form-item>
              </el-col>
              <el-col :xs="24" :sm="12" :md="4">
                <el-form-item label="浏览器界面">
                  <el-switch
                    v-model="visibleBrowser"
                    inline-prompt
                    active-text="显示"
                    inactive-text="隐藏"
                  />
                </el-form-item>
              </el-col>
              <el-col :xs="24" :sm="12" :md="4">
                <el-form-item label="评论抓取数">
                  <el-input-number v-model="form.commentLimit" :min="5" :max="100" />
                </el-form-item>
              </el-col>
              <el-col :xs="24" :sm="12" :md="4">
                <el-form-item label="最大条数">
                  <el-input-number v-model="form.maxItems" :min="1" :max="500" />
                </el-form-item>
              </el-col>
              <el-col :xs="24" :sm="12" :md="4">
                <el-form-item label="最长运行(分钟)">
                  <el-input-number v-model="durationMinutes" :min="1" :max="720" />
                </el-form-item>
              </el-col>
              <el-col :xs="24" :sm="12" :md="4">
                <el-form-item label="跳过直播">
                  <el-switch
                    v-model="form.skipLive"
                    inline-prompt
                    active-text="开启"
                    inactive-text="关闭"
                  />
                </el-form-item>
              </el-col>
              <el-col :xs="24" :sm="12" :md="4">
                <el-form-item label="优先站内连播">
                  <el-switch
                    v-model="form.preferNativeAutoplay"
                    inline-prompt
                    active-text="开启"
                    inactive-text="关闭"
                  />
                </el-form-item>
              </el-col>
              <el-col :xs="24" :sm="12" :md="4">
                <el-form-item label="连播最长秒数">
                  <el-input-number
                    v-model="form.nativeAutoplayMaxSeconds"
                    :min="10"
                    :max="3600"
                    :disabled="!form.preferNativeAutoplay"
                  />
                </el-form-item>
              </el-col>
              <el-col :xs="24" :sm="12" :md="4">
                <el-form-item label="手动切换基准秒数">
                  <el-input-number
                    v-model="form.manualAdvanceBaseSeconds"
                    :min="1"
                    :max="600"
                    :disabled="form.preferNativeAutoplay"
                  />
                </el-form-item>
              </el-col>
              <el-col :xs="24" :sm="12" :md="4">
                <el-form-item label="手动切换浮动秒数">
                  <el-input-number
                    v-model="form.manualAdvanceJitterSeconds"
                    :min="0"
                    :max="30"
                    :disabled="form.preferNativeAutoplay"
                  />
                </el-form-item>
              </el-col>
            </el-row>
          </el-form>

          <el-alert
            title="目标页校验"
            description="任务只认你填写的推荐页地址。如果被抖音跳到其他页面，会立即停止。"
            type="warning"
            :closable="false"
            show-icon
            style="margin-top: 8px"
          />

          <el-alert
            :title="form.preferNativeAutoplay ? '当前模式：站内连播' : '当前模式：手动切换'"
            :description="
              form.preferNativeAutoplay
                ? `系统会检查并开启抖音页面连播按钮，不主动翻页；如果 ${form.nativeAutoplayMaxSeconds} 秒内还没切到下一条，则兜底手动切换。`
                : `系统会先检查并关闭抖音页面连播按钮，再按 ${form.manualAdvanceBaseSeconds} ± ${form.manualAdvanceJitterSeconds} 秒手动切换。`
            "
            type="info"
            :closable="false"
            show-icon
            style="margin-top: 8px"
          />

          <el-alert
            v-if="status.stopReason"
            title="上次停止原因"
            :description="status.stopReason"
            type="warning"
            :closable="false"
            show-icon
            style="margin-top: 8px"
          />
        </el-card>

        <el-alert
          v-if="message.text"
          :title="message.title"
          :description="message.text"
          :type="message.type || 'info'"
          show-icon
          :closable="false"
        />

        <section class="page-grid two">
          <el-card class="panel-card">
            <template #header>
              <div class="panel-toolbar">
                <div>
                  <h3 class="panel-title">批次记录</h3>
                  <p class="panel-desc">支持删除旧批次，方便清理测试数据。</p>
                </div>
                <el-button :loading="runsLoading" @click="loadRuns">刷新批次</el-button>
              </div>
            </template>

            <el-table :data="runs" stripe max-height="420" highlight-current-row @row-click="selectRun">
              <el-table-column label="开始时间" min-width="170">
                <template #default="{ row }">{{ formatDate(row.startedAt) }}</template>
              </el-table-column>
              <el-table-column label="状态" width="110">
                <template #default="{ row }">
                  <el-tag :type="runStatusType(row.status)" effect="light">{{ row.status }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="曝光" width="90">
                <template #default="{ row }">{{ row.totals?.seenCount || 0 }}</template>
              </el-table-column>
              <el-table-column label="操作" width="120" fixed="right">
                <template #default="{ row }">
                  <el-button
                    size="small"
                    type="danger"
                    :loading="deletingRunId === row._id"
                    @click.stop="deleteRun(row)"
                  >
                    删除
                  </el-button>
                </template>
              </el-table-column>
            </el-table>

            <el-empty v-if="runs.length === 0" description="还没有推荐流运行记录" />
          </el-card>

          <el-card class="panel-card">
            <template #header>
              <div class="panel-toolbar">
                <div>
                  <h3 class="panel-title">曝光记录</h3>
                  <p class="panel-desc">查看每一条曝光的处理状态。</p>
                </div>
                <el-tag :type="selectedRun ? 'success' : 'info'">
                  {{ selectedRun ? "已选择批次" : "未选择批次" }}
                </el-tag>
              </div>
            </template>

            <el-empty v-if="!selectedRun" description="从左侧选择一个批次查看曝光记录" />
            <el-table v-else :data="exposures" stripe max-height="420" v-loading="exposuresLoading">
              <el-table-column label="#" width="70">
                <template #default="{ row }">{{ row.exposureIndex }}</template>
              </el-table-column>
              <el-table-column label="作品" min-width="180" show-overflow-tooltip>
                <template #default="{ row }">
                  {{ row.awemeId || row.snapshot?.titleGuess || "-" }}
                </template>
              </el-table-column>
              <el-table-column label="类型" width="90">
                <template #default="{ row }">
                  <el-tag size="small">{{ row.itemType || "unknown" }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="分析状态" width="120">
                <template #default="{ row }">{{ row.analysisStatus || "pending" }}</template>
              </el-table-column>
              <el-table-column label="时间" min-width="170">
                <template #default="{ row }">{{ formatDate(row.exposedAt) }}</template>
              </el-table-column>
            </el-table>
          </el-card>
        </section>
      </div>

      <el-card class="panel-card">
        <template #header>
          <div class="panel-toolbar">
            <div>
              <h3 class="panel-title">实时日志</h3>
              <p class="panel-desc">这里会持续显示推荐流任务状态和切换日志。</p>
            </div>
            <el-tag :type="status.running ? 'success' : 'info'">{{ logs.length }} 条</el-tag>
          </div>
        </template>

        <div class="log-stream">
          <el-empty v-if="logs.length === 0" description="任务开始后会出现实时日志" />
          <article v-for="item in logs" :key="item.id" class="log-entry">
            <div class="log-entry__meta">
              <strong>{{ levelLabelMap[item.level] || item.level }}</strong>
              <span>{{ formatDate(item.createdAt) }}</span>
            </div>
            <p>{{ item.message }}</p>
            <pre v-if="item.payload">{{ formatPayload(item.payload) }}</pre>
          </article>
        </div>
      </el-card>
    </section>
  </AppShell>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import AppShell from "../components/layout/AppShell.vue";
import { api } from "../services/api.js";

const levelLabelMap = {
  info: "信息",
  success: "成功",
  warning: "警告",
  error: "错误",
};

const submitting = ref(false);
const preparingBrowser = ref(false);
const runsLoading = ref(false);
const exposuresLoading = ref(false);
const deletingRunId = ref("");
const runs = ref([]);
const exposures = ref([]);
const logs = ref([]);
const selectedRun = ref(null);
let eventSource = null;

const form = reactive({
  targetUrl: "https://www.douyin.com/?recommend=1",
  headless: false,
  commentLimit: 30,
  maxItems: 50,
  maxDurationMs: 30 * 60 * 1000,
  skipLive: true,
  preferNativeAutoplay: true,
  nativeAutoplayMaxSeconds: 120,
  manualAdvanceBaseSeconds: 10,
  manualAdvanceJitterSeconds: 2,
});

const status = reactive({
  running: false,
  transitionState: "idle",
  isSettling: false,
  runId: "",
  startedAt: null,
  stoppedAt: null,
  lastHeartbeatAt: null,
  stopReason: "",
  config: null,
  totals: {
    seenCount: 0,
    uniqueCount: 0,
    duplicateCount: 0,
    liveSkippedCount: 0,
    analyzedCount: 0,
    failedCount: 0,
  },
});

const message = reactive({
  type: "",
  title: "",
  text: "",
});

const visibleBrowser = computed({
  get() {
    return !form.headless;
  },
  set(value) {
    form.headless = !value;
  },
});

const durationMinutes = computed({
  get() {
    return Math.round(Number(form.maxDurationMs || 0) / 60000);
  },
  set(value) {
    form.maxDurationMs = Math.max(1, Number(value) || 1) * 60000;
  },
});

const runTransitionBusy = computed(
  () =>
    submitting.value ||
    status.isSettling ||
    status.transitionState === "starting" ||
    status.transitionState === "stopping" ||
    status.transitionState === "finishing"
);

const runStateLabel = computed(() => {
  if (status.transitionState === "starting") {
    return "启动中";
  }

  if (status.transitionState === "stopping") {
    return "停止中";
  }

  if (status.transitionState === "finishing") {
    return "清理中";
  }

  return status.running ? "运行中" : "已停止";
});

const runStateTagType = computed(() => {
  if (status.transitionState === "starting") {
    return "warning";
  }

  if (status.transitionState === "stopping" || status.transitionState === "finishing") {
    return "danger";
  }

  return status.running ? "success" : "info";
});

function setMessage(type, title, text) {
  message.type = type;
  message.title = title;
  message.text = text;
  ElMessage({
    type: type === "error" ? "error" : type || "info",
    message: title ? `${title}：${text}` : text,
    duration: 2600,
  });
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString("zh-CN");
}

function formatPayload(value) {
  return JSON.stringify(value, null, 2);
}

function runStatusType(value) {
  if (value === "running") return "primary";
  if (value === "success") return "success";
  if (value === "failed") return "danger";
  return "info";
}

function applyStatus(payload) {
  status.running = Boolean(payload?.running);
  status.transitionState = payload?.transitionState || "idle";
  status.isSettling = Boolean(payload?.isSettling);
  status.runId = payload?.runId || "";
  status.startedAt = payload?.startedAt || null;
  status.stoppedAt = payload?.stoppedAt || null;
  status.lastHeartbeatAt = payload?.lastHeartbeatAt || null;
  status.stopReason = payload?.stopReason || "";
  status.config = payload?.config || null;
  status.totals = {
    seenCount: payload?.totals?.seenCount || 0,
    uniqueCount: payload?.totals?.uniqueCount || 0,
    duplicateCount: payload?.totals?.duplicateCount || 0,
    liveSkippedCount: payload?.totals?.liveSkippedCount || 0,
    analyzedCount: payload?.totals?.analyzedCount || 0,
    failedCount: payload?.totals?.failedCount || 0,
  };

  if (Array.isArray(payload?.recentLogs)) {
    logs.value = payload.recentLogs.slice().reverse().slice(0, 60);
  }
}

function appendLog(log) {
  if (!log?.id) return;
  if (logs.value.some((item) => item.id === log.id)) return;
  logs.value = [log, ...logs.value].slice(0, 60);
}

function setupStream() {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource(api.getRecommendFeedStreamUrl());
  eventSource.addEventListener("status", (event) => {
    try {
      applyStatus(JSON.parse(event.data));
    } catch (error) {
      console.error(error);
    }
  });
  eventSource.addEventListener("log", (event) => {
    try {
      appendLog(JSON.parse(event.data));
    } catch (error) {
      console.error(error);
    }
  });
  eventSource.onerror = () => {};
}

async function loadStatus() {
  const response = await api.getRecommendFeedStatus();
  applyStatus(response.data);
}

async function loadRuns() {
  runsLoading.value = true;
  try {
    const response = await api.getRecommendRuns({ limit: 20 });
    runs.value = response.data;
  } catch (error) {
    setMessage("error", "批次加载失败", error.message || "无法读取推荐流批次");
  } finally {
    runsLoading.value = false;
  }
}

async function selectRun(item) {
  selectedRun.value = item;
  exposuresLoading.value = true;
  try {
    const response = await api.getRecommendRunExposures(item._id, { limit: 100 });
    exposures.value = response.data;
  } catch (error) {
    exposures.value = [];
    setMessage("error", "曝光记录加载失败", error.message || "无法读取曝光记录");
  } finally {
    exposuresLoading.value = false;
  }
}

async function startRun() {
  submitting.value = true;
  try {
    const response = await api.startRecommendFeed({ ...form });
    applyStatus(response.data);
    setMessage("success", "推荐流已启动", "状态流和运行批次已经创建");
    await loadRuns();
  } catch (error) {
    setMessage("error", "启动失败", error.message || "推荐流任务启动失败");
  } finally {
    submitting.value = false;
  }
}

async function openBrowserSession() {
  preparingBrowser.value = true;
  try {
    const response = await api.prepareBrowserSession({
      targetUrl: form.targetUrl,
    });
    setMessage(
      "info",
      "登录浏览器已启动",
      `浏览器将尝试打开：${response.data.targetUrl}`
    );
  } catch (error) {
    setMessage("error", "无法打开登录浏览器", error.message || "浏览器启动失败");
  } finally {
    preparingBrowser.value = false;
  }
}

async function stopRun() {
  submitting.value = true;
  try {
    const response = await api.stopRecommendFeed();
    applyStatus(response.data);
    setMessage("info", "推荐流已停止", "任务已停止，批次记录已更新");
    await loadRuns();
  } catch (error) {
    setMessage("error", "停止失败", error.message || "推荐流任务停止失败");
  } finally {
    submitting.value = false;
  }
}

async function deleteRun(item) {
  try {
    await ElMessageBox.confirm(
      `确认删除批次 ${formatDate(item.startedAt)} 吗？这会删除该批次及其曝光记录。`,
      "删除确认",
      {
        type: "warning",
        confirmButtonText: "确认删除",
        cancelButtonText: "取消",
      }
    );
  } catch {
    return;
  }

  deletingRunId.value = item._id;
  try {
    await api.deleteRecommendRun(item._id);
    if (selectedRun.value?._id === item._id) {
      selectedRun.value = null;
      exposures.value = [];
    }
    setMessage("success", "删除完成", "推荐批次已删除");
    await loadRuns();
  } catch (error) {
    setMessage("error", "删除失败", error.message || "推荐批次删除失败");
  } finally {
    deletingRunId.value = "";
  }
}

onMounted(async () => {
  setupStream();
  try {
    await Promise.all([loadStatus(), loadRuns()]);
  } catch (error) {
    setMessage("error", "页面加载失败", error.message || "无法加载推荐流页面");
  }
});

onBeforeUnmount(() => {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
});
</script>
