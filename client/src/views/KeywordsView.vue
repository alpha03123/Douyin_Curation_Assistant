<template>
  <AppShell>
    <template #header>
      <section class="hero-panel">
        <p class="hero-panel__kicker">Discovery Console</p>
        <div class="hero-panel__main">
          <div>
            <h2 class="hero-panel__title">关键词中心</h2>
            <p class="hero-panel__desc">
              统一管理采集关键词、浏览器验证、连续采集和实时日志，确保数据链路持续稳定。
            </p>
          </div>
          <div class="hero-panel__stats">
            <el-tag :type="continuousStatus.running ? 'success' : 'info'" effect="dark">
              {{ continuousStatus.running ? "连续采集运行中" : "连续采集已停止" }}
            </el-tag>
            <el-tag type="primary">启用关键词 {{ enabledKeywordCount }}</el-tag>
            <el-tag :type="browserSession.dyCookiesReady ? 'success' : 'warning'">
              {{ browserSession.dyCookiesReady ? "Cookie 已配置" : "Cookie 未配置" }}
            </el-tag>
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
                <h3 class="panel-title">连续采集引擎</h3>
                <p class="panel-desc">围绕已启用关键词循环采集，直到手动停止。</p>
              </div>
              <div class="panel-toolbar__actions">
                <el-tag :type="continuousStatus.running ? 'success' : 'info'" effect="light">
                  {{ continuousStatus.running ? "运行中" : "已停止" }}
                </el-tag>
                <el-button
                  type="primary"
                  :loading="continuousLoading && !continuousStatus.running"
                  :disabled="continuousLoading || continuousStatus.running"
                  @click="startContinuousDiscovery"
                >
                  启动连续采集
                </el-button>
                <el-button
                  type="danger"
                  :loading="continuousLoading && continuousStatus.running"
                  :disabled="continuousLoading || !continuousStatus.running"
                  @click="stopContinuousDiscovery"
                >
                  停止连续采集
                </el-button>
              </div>
            </div>
          </template>

          <div class="stat-grid">
            <article class="stat-box">
              <strong>开始时间</strong>
              <p>{{ formatDate(continuousStatus.startedAt) }}</p>
            </article>
            <article class="stat-box">
              <strong>最近心跳</strong>
              <p>{{ formatDate(continuousStatus.lastHeartbeatAt) }}</p>
            </article>
            <article class="stat-box">
              <strong>轮次</strong>
              <p>{{ continuousStatus.totals.rounds }}</p>
            </article>
            <article class="stat-box">
              <strong>新增作品</strong>
              <p>{{ continuousStatus.totals.insertedCount }}</p>
            </article>
          </div>

          <el-form label-position="top" style="margin-top: 14px">
            <el-row :gutter="12">
              <el-col :xs="24" :sm="12" :md="8">
                <el-form-item label="每次抓取数量">
                  <el-input-number v-model="continuousForm.pageSize" :min="1" :max="25" />
                </el-form-item>
              </el-col>
              <el-col :xs="24" :sm="12" :md="8">
                <el-form-item label="关键词间隔(ms)">
                  <el-input-number
                    v-model="continuousForm.requestIntervalMs"
                    :min="1000"
                    :step="1000"
                  />
                </el-form-item>
              </el-col>
              <el-col :xs="24" :sm="12" :md="8">
                <el-form-item label="轮次间隔(ms)">
                  <el-input-number
                    v-model="continuousForm.cycleIntervalMs"
                    :min="1000"
                    :step="1000"
                  />
                </el-form-item>
              </el-col>
              <el-col :xs="24" :sm="12" :md="8">
                <el-form-item label="排序方式">
                  <el-select v-model="continuousForm.sortType">
                    <el-option label="综合排序" value="0" />
                    <el-option label="最多点赞" value="1" />
                    <el-option label="最新发布" value="2" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :xs="24" :sm="12" :md="8">
                <el-form-item label="发布时间">
                  <el-select v-model="continuousForm.publishTime">
                    <el-option label="不限" value="0" />
                    <el-option label="一天内" value="1" />
                    <el-option label="一周内" value="7" />
                    <el-option label="半年内" value="180" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :xs="24" :sm="12" :md="8">
                <el-form-item label="内容形式">
                  <el-select v-model="continuousForm.contentType">
                    <el-option label="不限" value="0" />
                    <el-option label="只看视频" value="1" />
                    <el-option label="只看图文" value="2" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :xs="24" :sm="12" :md="8">
                <el-form-item label="搜索策略">
                  <el-select v-model="continuousForm.searchStrategy">
                    <el-option label="自动模式（推荐）" value="auto" />
                    <el-option label="高速模式" value="fast" />
                    <el-option label="稳妥模式" value="safe" />
                  </el-select>
                </el-form-item>
              </el-col>
            </el-row>
          </el-form>

          <el-alert
            v-if="continuousStatus.stopReason"
            style="margin-top: 8px"
            type="warning"
            :closable="false"
            show-icon
            title="上次停止原因"
            :description="continuousStatus.stopReason"
          />
        </el-card>

        <section class="page-grid two">
          <el-card class="panel-card">
            <template #header>
              <div class="panel-toolbar">
                <div>
                  <h3 class="panel-title">浏览器会话</h3>
                  <p class="panel-desc">遇到验证或风控时，在此直接打开浏览器完成登录。</p>
                </div>
                <div class="panel-toolbar__actions">
                  <el-button :loading="preparingBrowser" type="primary" @click="openBrowserSession">
                    打开验证浏览器
                  </el-button>
                  <el-button @click="loadBrowserSession()">刷新状态</el-button>
                  <el-button
                    type="warning"
                    plain
                    :loading="diagnosingProfile === 'runtime'"
                    :disabled="Boolean(diagnosingProfile)"
                    @click="runDeepInspection('runtime')"
                  >
                    深检 Runtime
                  </el-button>
                  <el-button
                    type="warning"
                    plain
                    :loading="diagnosingProfile === 'lab'"
                    :disabled="Boolean(diagnosingProfile)"
                    @click="runDeepInspection('lab')"
                  >
                    深检 Lab
                  </el-button>
                </div>
              </div>
            </template>

            <el-descriptions :column="1" border>
              <el-descriptions-item label="浏览器环境">
                <el-tag :type="browserSession.browserAvailable ? 'success' : 'danger'" effect="light">
                  {{ browserSession.browserAvailable ? "已检测到" : "未检测到" }}
                </el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="DY_COOKIES">
                <el-tag :type="browserSession.dyCookiesReady ? 'success' : 'warning'" effect="light">
                  {{ browserSession.dyCookiesReady ? "已就绪" : "未配置" }}
                </el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="Profile 目录">
                <span>{{ browserSession.profileExists ? "已存在" : "尚未创建" }}</span>
              </el-descriptions-item>
              <el-descriptions-item label="审核 Lab">
                <el-tag :type="browserSession.labSession?.loginReady ? 'success' : 'warning'" effect="light">
                  {{ browserSession.labSession?.loginReady ? "已就绪" : "未就绪" }}
                </el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="首选来源">
                <span>{{ sessionSourceLabel(browserSession.preferredSource?.sourceKey) }}</span>
              </el-descriptions-item>
            </el-descriptions>

            <el-alert
              style="margin-top: 12px"
              :title="browserSession.statusSummary || '状态说明'"
              :description="browserSession.statusSummary || '还没有读取到会话说明'"
              :type="browserSession.loginReady || browserSession.labSession?.loginReady ? 'success' : 'warning'"
              :closable="false"
              show-icon
            />

            <div style="margin-top: 12px" class="page-stack">
              <div v-if="browserSession.executablePath" class="mono">{{ browserSession.executablePath }}</div>
              <div v-if="browserSession.profileDir" class="mono">{{ browserSession.profileDir }}</div>
              <div v-if="browserSession.labProfileDir" class="mono">{{ browserSession.labProfileDir }}</div>
            </div>
          </el-card>

          <el-card class="panel-card">
            <template #header>
              <h3 class="panel-title">手动采集参数</h3>
            </template>
            <el-form label-position="top">
              <el-form-item label="采集数量">
                <el-input-number v-model="runSettings.requireNum" :min="1" :max="100" />
              </el-form-item>
              <el-form-item label="排序方式">
                <el-select v-model="runSettings.sortType">
                  <el-option label="综合排序" value="0" />
                  <el-option label="最多点赞" value="1" />
                  <el-option label="最新发布" value="2" />
                </el-select>
              </el-form-item>
              <el-form-item label="发布时间">
                <el-select v-model="runSettings.publishTime">
                  <el-option label="不限" value="0" />
                  <el-option label="一天内" value="1" />
                  <el-option label="一周内" value="7" />
                  <el-option label="半年内" value="180" />
                </el-select>
              </el-form-item>
              <el-form-item label="内容形式">
                <el-select v-model="runSettings.contentType">
                  <el-option label="不限" value="0" />
                  <el-option label="只看视频" value="1" />
                  <el-option label="只看图文" value="2" />
                </el-select>
              </el-form-item>
              <el-form-item label="搜索策略">
                <el-select v-model="runSettings.searchStrategy">
                  <el-option label="自动模式（推荐）" value="auto" />
                  <el-option label="高速模式" value="fast" />
                  <el-option label="稳妥模式" value="safe" />
                </el-select>
              </el-form-item>
            </el-form>
          </el-card>
        </section>

        <el-card class="panel-card">
          <template #header>
            <div class="panel-toolbar">
              <div>
                <h3 class="panel-title">关键词编辑器</h3>
                <p class="panel-desc">启用后的关键词会参与连续采集，也可以单独手动触发。</p>
              </div>
              <el-button v-if="editingKeywordId" @click="resetKeywordForm">取消编辑</el-button>
            </div>
          </template>

          <el-form label-position="top" @submit.prevent="submitKeyword">
            <el-row :gutter="12">
              <el-col :xs="24" :sm="16">
                <el-form-item label="关键词">
                  <el-input v-model="keywordForm.keyword" placeholder="例如：穿搭、甜妹、气质" />
                </el-form-item>
              </el-col>
              <el-col :xs="24" :sm="8">
                <el-form-item label="默认采集数量">
                  <el-input-number v-model="keywordForm.dailyLimit" :min="1" :max="200" />
                </el-form-item>
              </el-col>
            </el-row>
            <el-form-item label="备注">
              <el-input v-model="keywordForm.note" placeholder="给这个关键词写一个说明" />
            </el-form-item>
            <el-form-item label="状态">
              <el-switch
                v-model="keywordForm.enabled"
                inline-prompt
                active-text="启用"
                inactive-text="停用"
              />
            </el-form-item>
            <el-button type="primary" :loading="keywordSubmitting" @click="submitKeyword">
              {{ editingKeywordId ? "保存修改" : "保存关键词" }}
            </el-button>
          </el-form>
        </el-card>
      </div>

      <el-card class="panel-card">
        <template #header>
          <div class="panel-toolbar">
            <div>
              <h3 class="panel-title">实时日志</h3>
              <p class="panel-desc">连续采集启动后，这里会持续输出最新状态与异常。</p>
            </div>
            <el-tag :type="continuousStatus.running ? 'success' : 'info'">{{ continuousLogs.length }} 条</el-tag>
          </div>
        </template>

        <div class="log-stream">
          <el-empty v-if="continuousLogs.length === 0" description="日志会在采集开始后显示" />
          <article v-for="item in continuousLogs" :key="item.id" class="log-entry">
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

    <el-alert
      v-if="message.text"
      :title="message.title"
      :description="message.text"
      :type="message.type || 'info'"
      show-icon
      :closable="false"
    />

    <el-card class="panel-card">
      <template #header>
        <div class="panel-toolbar">
          <div>
            <h3 class="panel-title">关键词列表</h3>
            <p class="panel-desc">共 {{ keywords.length }} 个关键词，其中 {{ enabledKeywordCount }} 个已启用。</p>
          </div>
        </div>
      </template>

      <el-table :data="keywords" stripe>
        <el-table-column prop="keyword" label="关键词" min-width="180" />
        <el-table-column prop="note" label="备注" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.note || "-" }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="row.enabled ? 'success' : 'info'" effect="light">
              {{ row.enabled ? "启用" : "停用" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="dailyLimit" label="默认数量" width="110" />
        <el-table-column label="更新时间" min-width="180">
          <template #default="{ row }">
            {{ formatDate(row.updatedAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="320" fixed="right">
          <template #default="{ row }">
            <div class="item-actions">
              <el-button
                type="primary"
                size="small"
                :loading="runningKeywordId === row._id"
                @click="runDiscovery(row)"
              >
                采集并入库
              </el-button>
              <el-button size="small" @click="startEditKeyword(row)">编辑</el-button>
              <el-button
                size="small"
                type="danger"
                :loading="deletingKeywordId === row._id"
                @click="deleteKeyword(row)"
              >
                删除
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <el-empty v-if="keywords.length === 0" description="还没有关键词，先新增一个开始采集" />
    </el-card>
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

const keywords = ref([]);
const runningKeywordId = ref("");
const deletingKeywordId = ref("");
const keywordSubmitting = ref(false);
const editingKeywordId = ref("");
const preparingBrowser = ref(false);
const continuousLoading = ref(false);
const continuousLogs = ref([]);
const lastVerifyKeyword = ref("");
const diagnosingProfile = ref("");
let discoveryEventSource = null;

const keywordForm = reactive({
  keyword: "",
  enabled: true,
  dailyLimit: 20,
  note: "",
});

const runSettings = reactive({
  requireNum: 20,
  sortType: "0",
  publishTime: "0",
  contentType: "0",
  searchStrategy: "auto",
});

const continuousForm = reactive({
  pageSize: 20,
  requestIntervalMs: 4000,
  cycleIntervalMs: 8000,
  sortType: "0",
  publishTime: "0",
  contentType: "0",
  searchStrategy: "auto",
});

const continuousStatus = reactive({
  running: false,
  startedAt: null,
  stoppedAt: null,
  lastHeartbeatAt: null,
  stopReason: "",
  config: null,
  totals: {
    rounds: 0,
    fetchedCount: 0,
    normalizedCount: 0,
    insertedCount: 0,
    modifiedCount: 0,
  },
});

const browserSession = reactive({
  browserAvailable: false,
  executablePath: "",
  profileDir: "",
  labProfileDir: "",
  profileExists: false,
  dyCookiesReady: false,
  loginReady: false,
  statusSummary: "",
  preferredSource: null,
  labSession: {
    loginReady: false,
  },
});

const message = reactive({
  type: "",
  title: "",
  text: "",
});

const enabledKeywordCount = computed(
  () => keywords.value.filter((item) => item.enabled).length
);

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

function sessionSourceLabel(sourceKey) {
  if (sourceKey === "runtime") return "Runtime Profile";
  if (sourceKey === "lab") return "审核 Lab Profile";
  if (sourceKey === "env") return "DY_COOKIES";
  return "-";
}

function diagnosticProfileLabel(profileKey) {
  if (profileKey === "runtime") return "Runtime Profile";
  if (profileKey === "lab") return "审核 Lab Profile";
  return profileKey || "目标 Profile";
}

function formatPayload(value) {
  return JSON.stringify(value, null, 2);
}

function resetKeywordForm() {
  editingKeywordId.value = "";
  keywordForm.keyword = "";
  keywordForm.enabled = true;
  keywordForm.dailyLimit = 20;
  keywordForm.note = "";
}

function applyContinuousStatus(payload) {
  continuousStatus.running = Boolean(payload?.running);
  continuousStatus.startedAt = payload?.startedAt || null;
  continuousStatus.stoppedAt = payload?.stoppedAt || null;
  continuousStatus.lastHeartbeatAt = payload?.lastHeartbeatAt || null;
  continuousStatus.stopReason = payload?.stopReason || "";
  continuousStatus.config = payload?.config || null;
  continuousStatus.totals = {
    rounds: payload?.totals?.rounds || 0,
    fetchedCount: payload?.totals?.fetchedCount || 0,
    normalizedCount: payload?.totals?.normalizedCount || 0,
    insertedCount: payload?.totals?.insertedCount || 0,
    modifiedCount: payload?.totals?.modifiedCount || 0,
  };

  if (Array.isArray(payload?.recentLogs)) {
    continuousLogs.value = payload.recentLogs.slice().reverse().slice(0, 60);
  }
}

function appendContinuousLog(log) {
  if (!log?.id) {
    return;
  }

  if (continuousLogs.value.some((item) => item.id === log.id)) {
    return;
  }

  continuousLogs.value = [log, ...continuousLogs.value].slice(0, 60);
}

function setupDiscoveryStream() {
  if (discoveryEventSource) {
    discoveryEventSource.close();
  }

  discoveryEventSource = new EventSource(api.getContinuousDiscoveryStreamUrl());
  discoveryEventSource.addEventListener("status", (event) => {
    try {
      applyContinuousStatus(JSON.parse(event.data));
    } catch (error) {
      console.error(error);
    }
  });
  discoveryEventSource.addEventListener("log", (event) => {
    try {
      appendContinuousLog(JSON.parse(event.data));
    } catch (error) {
      console.error(error);
    }
  });
  discoveryEventSource.onerror = () => {};
}

async function loadKeywords() {
  const response = await api.getKeywords();
  keywords.value = response.data;
}

async function loadBrowserSession(options = {}) {
  const response = await api.getBrowserSession(options);
  Object.assign(browserSession, response.data);
}

async function runDeepInspection(profileKey) {
  const profileLabel = diagnosticProfileLabel(profileKey);

  try {
    await ElMessageBox.confirm(
      `确认执行 ${profileLabel} 深度检查吗？这会临时启动该 Profile 的浏览器内核检查，耗时更长且资源占用更高。`,
      "深度检查确认",
      {
        type: "warning",
        confirmButtonText: "开始深检",
        cancelButtonText: "取消",
      }
    );
  } catch {
    return;
  }

  diagnosingProfile.value = profileKey;

  try {
    await loadBrowserSession({ deepProfile: profileKey });
    setMessage("success", "深度检查完成", `${profileLabel} 深度检查已完成`);
  } catch (error) {
    setMessage("error", "深度检查失败", error.message);
  } finally {
    diagnosingProfile.value = "";
  }
}

async function loadContinuousDiscoveryStatus() {
  const response = await api.getContinuousDiscoveryStatus();
  applyContinuousStatus(response.data);
}

async function submitKeyword() {
  keywordSubmitting.value = true;

  try {
    if (editingKeywordId.value) {
      await api.updateKeyword(editingKeywordId.value, { ...keywordForm });
      setMessage("success", "关键词已更新", "关键词修改已保存");
    } else {
      await api.createKeyword({ ...keywordForm });
      setMessage("success", "关键词已保存", "现在可以直接点击“采集并入库”");
    }

    resetKeywordForm();
    await loadKeywords();
  } catch (error) {
    setMessage("error", "保存失败", error.message);
  } finally {
    keywordSubmitting.value = false;
  }
}

function startEditKeyword(item) {
  editingKeywordId.value = item._id;
  keywordForm.keyword = item.keyword || "";
  keywordForm.enabled = Boolean(item.enabled);
  keywordForm.dailyLimit = Number(item.dailyLimit || 20);
  keywordForm.note = item.note || "";
}

async function deleteKeyword(item) {
  try {
    await ElMessageBox.confirm(`确认删除关键词“${item.keyword}”吗？`, "删除确认", {
      type: "warning",
      confirmButtonText: "确认删除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }

  deletingKeywordId.value = item._id;

  try {
    await api.deleteKeyword(item._id);
    if (editingKeywordId.value === item._id) {
      resetKeywordForm();
    }
    setMessage("success", "关键词已删除", `关键词“${item.keyword}”已删除`);
    await loadKeywords();
  } catch (error) {
    setMessage("error", "删除失败", error.message);
  } finally {
    deletingKeywordId.value = "";
  }
}

async function openBrowserSession() {
  preparingBrowser.value = true;

  try {
    const payload = {};
    if (lastVerifyKeyword.value) {
      payload.targetUrl = `https://www.douyin.com/search/${encodeURIComponent(
        lastVerifyKeyword.value
      )}?type=general`;
    }

    const response = await api.prepareBrowserSession(payload);
    setMessage("info", "验证浏览器已启动", response.data.message);
    Object.assign(browserSession, {
      browserAvailable: true,
      executablePath: response.data.executablePath || browserSession.executablePath,
      profileDir: response.data.profileDir || browserSession.profileDir,
      targetUrl: response.data.targetUrl || browserSession.targetUrl,
      statusSummary: response.data.message || browserSession.statusSummary,
    });
  } catch (error) {
    setMessage("error", "无法打开验证浏览器", error.message);
  } finally {
    preparingBrowser.value = false;
  }
}

async function runDiscovery(item) {
  runningKeywordId.value = item._id;
  setMessage("info", "正在采集", `正在处理关键词“${item.keyword}”`);

  try {
    const response = await api.discoverKeyword(item._id, {
      requireNum: runSettings.requireNum || item.dailyLimit,
      sortType: runSettings.sortType,
      publishTime: runSettings.publishTime,
      contentType: runSettings.contentType,
      searchStrategy: runSettings.searchStrategy,
    });
    const result = response.data;

    setMessage(
      "success",
      "采集完成",
      `关键词“${item.keyword}”本次抓取 ${result.fetchedCount} 条，整理 ${result.normalizedCount} 条，新增 ${result.insertedCount} 条`
    );
  } catch (error) {
    if (error.code === "DOUYIN_VERIFY_CHECK") {
      lastVerifyKeyword.value = item.keyword || "";
      setMessage(
        "error",
        "需要先完成验证码验证",
        "当前搜索被风控拦截。请先打开验证浏览器完成登录或验证码，再回来重试。"
      );
      await loadBrowserSession().catch(() => {});
      return;
    }

    setMessage("error", "采集失败", error.message);
  } finally {
    runningKeywordId.value = "";
  }
}

async function startContinuousDiscovery() {
  continuousLoading.value = true;

  try {
    const response = await api.startContinuousDiscovery({ ...continuousForm });
    applyContinuousStatus(response.data);
    setMessage("success", "连续采集已启动", "现在可以在右侧观察实时日志");
  } catch (error) {
    setMessage("error", "启动失败", error.message);
  } finally {
    continuousLoading.value = false;
  }
}

async function stopContinuousDiscovery() {
  continuousLoading.value = true;

  try {
    const response = await api.stopContinuousDiscovery();
    applyContinuousStatus(response.data);
    setMessage("info", "连续采集已停止", "采集任务已经停止");
  } catch (error) {
    setMessage("error", "停止失败", error.message);
  } finally {
    continuousLoading.value = false;
  }
}

onMounted(async () => {
  setupDiscoveryStream();

  try {
    await Promise.all([
      loadKeywords(),
      loadBrowserSession(),
      loadContinuousDiscoveryStatus(),
    ]);
  } catch (error) {
    setMessage("error", "加载失败", error.message);
  }
});

onBeforeUnmount(() => {
  if (discoveryEventSource) {
    discoveryEventSource.close();
    discoveryEventSource = null;
  }
});
</script>
