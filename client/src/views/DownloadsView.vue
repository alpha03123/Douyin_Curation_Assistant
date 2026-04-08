<template>
  <AppShell>
    <template #header>
      <section class="hero-panel">
        <p class="hero-panel__kicker">Download Center</p>
        <div class="hero-panel__main">
          <div>
            <h2 class="hero-panel__title">下载中心</h2>
            <p class="hero-panel__desc">
              支持解析任意抖音链接，创建视频、图集、合集、音乐下载任务，并查看执行结果。
            </p>
          </div>
          <div class="hero-panel__stats">
            <el-tag type="primary">URL 任务 {{ downloadTasks.length }}</el-tag>
            <el-tag :type="resolvedSource ? 'success' : 'info'">
              {{ resolvedSource ? resolvedSource.parsedType : "等待解析" }}
            </el-tag>
          </div>
        </div>
      </section>
    </template>

    <section class="page-grid two">
      <el-card class="panel-card">
        <template #header>
          <div class="panel-toolbar">
            <div>
              <h3 class="panel-title">链接解析</h3>
              <p class="panel-desc">先解析链接类型，再选择需要下载的资源。</p>
            </div>
            <div class="panel-toolbar__actions">
              <el-button :loading="resolvingSource" type="primary" @click="resolveSource">
                解析链接
              </el-button>
            </div>
          </div>
        </template>

        <el-form label-position="top">
          <el-form-item label="抖音链接">
            <el-input
              v-model="sourceForm.sourceUrl"
              type="textarea"
              :rows="3"
              placeholder="粘贴视频、图集、合集、音乐或短链"
            />
          </el-form-item>
        </el-form>

        <el-alert
          v-if="resolvedSource"
          type="success"
          :closable="false"
          show-icon
          :title="resolvedSource.title || resolvedSource.sourceId"
          :description="`${resolvedSource.authorName || 'unknown-author'} · ${resolvedSource.parsedType} · ${resolvedSource.itemCount || 1} 项`"
          style="margin-bottom: 12px"
        />

        <template v-if="resolvedSource">
          <el-form label-position="top">
            <el-form-item label="下载资源">
              <el-checkbox-group v-model="sourceForm.assets">
                <el-checkbox
                  v-for="asset in resolvedSource.supportedAssets"
                  :key="asset"
                  :label="asset"
                >
                  {{ assetLabelMap[asset] || asset }}
                </el-checkbox>
              </el-checkbox-group>
            </el-form-item>

            <el-form-item label="去水印">
              <el-switch
                v-model="sourceForm.removeWatermark"
                :disabled="resolvedSource.options?.removeWatermark === false"
                inline-prompt
                active-text="优先去水印"
                inactive-text="原链接"
              />
            </el-form-item>
          </el-form>

          <div class="item-actions">
            <el-button
              type="primary"
              :loading="creatingTask"
              :disabled="sourceForm.assets.length === 0"
              @click="createUrlTask"
            >
              创建下载任务
            </el-button>
          </div>
        </template>
      </el-card>

      <el-card class="panel-card">
        <template #header>
          <h3 class="panel-title">当前解析结果</h3>
        </template>

        <el-empty v-if="!resolvedSource" description="先解析一个链接" />

        <el-descriptions v-else :column="1" border>
          <el-descriptions-item label="类型">
            {{ resolvedSource.parsedType }}
          </el-descriptions-item>
          <el-descriptions-item label="标题">
            {{ resolvedSource.title || "-" }}
          </el-descriptions-item>
          <el-descriptions-item label="作者">
            {{ resolvedSource.authorName || "-" }}
          </el-descriptions-item>
          <el-descriptions-item label="条目数">
            {{ resolvedSource.itemCount || 1 }}
          </el-descriptions-item>
          <el-descriptions-item label="规范化链接">
            <span class="mono">{{ resolvedSource.normalizedUrl }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="资源支持">
            <div class="inline-tags">
              <el-tag
                v-for="asset in resolvedSource.supportedAssets"
                :key="asset"
                size="small"
              >
                {{ assetLabelMap[asset] || asset }}
              </el-tag>
            </div>
          </el-descriptions-item>
        </el-descriptions>
      </el-card>
    </section>

    <el-card class="panel-card">
      <template #header>
        <div class="panel-toolbar">
          <div>
            <h3 class="panel-title">下载任务列表</h3>
            <p class="panel-desc">只展示通过下载中心创建的 URL 下载任务。</p>
          </div>
          <div class="panel-toolbar__actions">
            <el-select v-model="taskFilters.status" clearable style="width: 160px">
              <el-option label="pending" value="pending" />
              <el-option label="running" value="running" />
              <el-option label="success" value="success" />
              <el-option label="partial_success" value="partial_success" />
              <el-option label="failed" value="failed" />
            </el-select>
            <el-button :loading="tasksLoading" @click="loadDownloadTasks">刷新任务</el-button>
          </div>
        </div>
      </template>

      <el-table :data="downloadTasks" stripe max-height="520">
        <el-table-column label="标题" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.title || row.sourceId || row.sourceUrl || "-" }}
          </template>
        </el-table-column>
        <el-table-column label="类型" width="120">
          <template #default="{ row }">
            <el-tag size="small">{{ row.parsedType || "unknown" }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="140">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" effect="light">
              {{ row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="进度" width="120">
          <template #default="{ row }">
            {{ row.downloadedFiles || 0 }}/{{ row.totalFiles || 0 }}
          </template>
        </el-table-column>
        <el-table-column label="作者" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.authorName || "-" }}
          </template>
        </el-table-column>
        <el-table-column label="更新时间" min-width="180">
          <template #default="{ row }">
            {{ formatDate(row.updatedAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <div class="item-actions">
              <el-button size="small" @click="openTaskFilesDialog(row)">查看文件</el-button>
              <el-button
                size="small"
                type="primary"
                :loading="retryingTaskId === row._id"
                :disabled="row.status === 'pending' || row.status === 'running'"
                @click="retryTask(row)"
              >
                重试
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <el-empty v-if="downloadTasks.length === 0" description="还没有 URL 下载任务" />
    </el-card>

    <el-dialog
      v-model="taskFilesDialogOpen"
      width="760px"
      title="任务文件列表"
      destroy-on-close
    >
      <div class="page-stack">
        <el-alert
          v-if="taskFilesDialogTask"
          :title="taskFilesDialogTask.title || taskFilesDialogTask.sourceId || '任务详情'"
          :description="taskFilesDialogTask.saveDir || '任务尚未生成保存目录'"
          :type="statusAlertType(taskFilesDialogTask.status)"
          :closable="false"
          show-icon
        />

        <el-table :data="taskFiles" stripe max-height="420">
          <el-table-column label="资源类型" width="120">
            <template #default="{ row }">
              <el-tag size="small">{{ row.assetType }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="文件名" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.fileName || "-" }}
            </template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="row.status === 'success' ? 'success' : 'danger'" effect="light">
                {{ row.status }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="大小" width="100">
            <template #default="{ row }">
              {{ formatFileSize(row.fileSize) }}
            </template>
          </el-table-column>
          <el-table-column label="本地路径" min-width="240" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.localPath || row.errorMessage || "-" }}
            </template>
          </el-table-column>
        </el-table>

        <el-empty v-if="taskFiles.length === 0" description="当前任务还没有产出文件" />
      </div>
    </el-dialog>
  </AppShell>
</template>

<script setup>
import { onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import AppShell from "../components/layout/AppShell.vue";
import { api } from "../services/api.js";

const assetLabelMap = {
  video: "视频",
  images: "图集",
  cover: "封面",
  music: "原声",
  metadata: "元数据",
};

const sourceForm = reactive({
  sourceUrl: "",
  assets: [],
  removeWatermark: true,
});

const taskFilters = reactive({
  status: "",
});

const resolvingSource = ref(false);
const creatingTask = ref(false);
const tasksLoading = ref(false);
const retryingTaskId = ref("");
const resolvedSource = ref(null);
const downloadTasks = ref([]);
const taskFilesDialogOpen = ref(false);
const taskFilesDialogTask = ref(null);
const taskFiles = ref([]);
let taskPollingTimer = null;

function setMessage(type, message) {
  ElMessage({
    type,
    message,
  });
}

function statusTagType(status) {
  if (status === "success") {
    return "success";
  }

  if (status === "partial_success") {
    return "warning";
  }

  if (status === "failed") {
    return "danger";
  }

  if (status === "running") {
    return "primary";
  }

  return "info";
}

function statusAlertType(status) {
  if (status === "success") {
    return "success";
  }

  if (status === "partial_success") {
    return "warning";
  }

  if (status === "failed") {
    return "error";
  }

  return "info";
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString("zh-CN");
}

function formatFileSize(value) {
  const size = Number(value || 0);
  if (!size) {
    return "-";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

async function resolveSource() {
  resolvingSource.value = true;

  try {
    const response = await api.resolveDownloadSource({
      sourceUrl: sourceForm.sourceUrl,
    });
    resolvedSource.value = response.data;
    sourceForm.assets = [...(response.data.supportedAssets || [])];
    sourceForm.removeWatermark = response.data.options?.removeWatermark !== false;
    setMessage("success", "链接解析成功");
  } catch (error) {
    resolvedSource.value = null;
    sourceForm.assets = [];
    setMessage("error", error.message || "链接解析失败");
  } finally {
    resolvingSource.value = false;
  }
}

async function createUrlTask() {
  if (!resolvedSource.value) {
    return;
  }

  creatingTask.value = true;

  try {
    const response = await api.createDownloadTask({
      sourceUrl: sourceForm.sourceUrl,
      assets: [...sourceForm.assets],
      removeWatermark: sourceForm.removeWatermark,
    });
    setMessage("success", `下载任务已创建：${response.data._id}`);
    await loadDownloadTasks();
  } catch (error) {
    setMessage("error", error.message || "创建下载任务失败");
  } finally {
    creatingTask.value = false;
  }
}

async function loadDownloadTasks({ silent = false } = {}) {
  tasksLoading.value = true;

  try {
    const response = await api.getDownloadTasks({
      sourceType: "url",
      status: taskFilters.status,
      limit: 20,
    });
    downloadTasks.value = response.data;
  } catch (error) {
    if (!silent) {
      setMessage("error", error.message || "下载任务加载失败");
    }
  } finally {
    tasksLoading.value = false;
  }
}

async function openTaskFilesDialog(task) {
  taskFilesDialogTask.value = task;
  taskFilesDialogOpen.value = true;

  try {
    const response = await api.getDownloadedAssets(task._id);
    taskFiles.value = response.data;
  } catch (error) {
    taskFiles.value = [];
    setMessage("error", error.message || "文件列表加载失败");
  }
}

async function retryTask(task) {
  retryingTaskId.value = task._id;

  try {
    await api.retryDownloadTask(task._id);
    setMessage("success", "任务已重新加入下载队列");
    await loadDownloadTasks();
  } catch (error) {
    setMessage("error", error.message || "任务重试失败");
  } finally {
    retryingTaskId.value = "";
  }
}

watch(
  () => taskFilters.status,
  async () => {
    await loadDownloadTasks();
  }
);

onMounted(async () => {
  await loadDownloadTasks();
  taskPollingTimer = setInterval(() => {
    loadDownloadTasks({ silent: true }).catch(() => {});
  }, 5000);
});

onBeforeUnmount(() => {
  if (taskPollingTimer) {
    clearInterval(taskPollingTimer);
    taskPollingTimer = null;
  }
});
</script>
