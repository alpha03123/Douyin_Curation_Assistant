<template>
  <AppShell>
    <template #header>
      <section class="hero-panel">
        <p class="hero-panel__kicker">Product Scope</p>
        <div class="hero-panel__main">
          <div>
            <h2 class="hero-panel__title">规划说明</h2>
            <p class="hero-panel__desc">
              明确当前已做能力与暂缓项，避免开发过程中持续偏离主链路。
            </p>
          </div>
          <div class="hero-panel__stats">
            <el-tag type="primary">当前范围 {{ roadmap.currentScope.length }}</el-tag>
            <el-tag type="warning">延期项 {{ roadmap.deferredScope.length }}</el-tag>
          </div>
        </div>
      </section>
    </template>

    <section class="page-grid two">
      <el-card class="panel-card">
        <template #header>
          <h3 class="panel-title">当前范围</h3>
        </template>
        <el-empty v-if="roadmap.currentScope.length === 0" description="暂无内容" />
        <el-timeline v-else>
          <el-timeline-item v-for="item in roadmap.currentScope" :key="item">{{ item }}</el-timeline-item>
        </el-timeline>
      </el-card>

      <el-card class="panel-card">
        <template #header>
          <h3 class="panel-title">当前不做</h3>
        </template>
        <el-empty v-if="roadmap.deferredScope.length === 0" description="暂无内容" />
        <el-timeline v-else>
          <el-timeline-item v-for="item in roadmap.deferredScope" :key="item" type="warning">
            {{ item }}
          </el-timeline-item>
        </el-timeline>
      </el-card>
    </section>

    <section class="page-grid two">
      <el-card class="panel-card">
        <template #header>
          <h3 class="panel-title">执行原则</h3>
        </template>
        <el-steps direction="vertical" :active="3" finish-status="success">
          <el-step title="先把可见链路跑稳" description="优先做可采集、可分析、可审核、可复盘的流程。" />
          <el-step title="规则先于自动化" description="先搭清规则和审核逻辑，再扩展自动化能力。" />
          <el-step title="保留人工干预位" description="评论草稿、作者审核、任务队列都保留人工确认。" />
        </el-steps>
      </el-card>

      <el-card class="panel-card">
        <template #header>
          <h3 class="panel-title">旧项目参考状态</h3>
        </template>

        <div class="stat-grid">
          <article class="stat-box">
            <strong>状态</strong>
            <p>{{ roadmap.legacyBridge.ready ? "已接入参考路径" : "未接入" }}</p>
          </article>
          <article class="stat-box">
            <strong>路径</strong>
            <p>{{ roadmap.legacyBridge.legacyProjectPath || "-" }}</p>
          </article>
        </div>

        <el-alert
          style="margin-top: 12px"
          title="说明"
          type="info"
          :description="roadmap.legacyBridge.message || '暂无说明'"
          show-icon
          :closable="false"
        />
      </el-card>
    </section>
  </AppShell>
</template>

<script setup>
import { onMounted, reactive } from "vue";
import AppShell from "../components/layout/AppShell.vue";
import { api } from "../services/api.js";

const roadmap = reactive({
  currentScope: [],
  deferredScope: [],
  legacyBridge: {
    ready: false,
    legacyProjectPath: "",
    message: "",
  },
});

onMounted(async () => {
  try {
    const response = await api.getRoadmap();
    Object.assign(roadmap, response.data);
  } catch (error) {
    console.error(error);
  }
});
</script>
