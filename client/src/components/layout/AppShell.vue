<template>
  <div class="shell-layout">
    <aside class="shell-aside" :class="{ 'is-collapsed': collapsed }">
      <div class="shell-brand">
        <p class="shell-brand__kicker">Douyin Curation Assistant</p>
        <h1>泡泡菌助手</h1>
        <p v-if="!collapsed" class="shell-brand__desc">采集、分析、直接互动一体化工作台</p>
      </div>

      <el-scrollbar class="shell-nav-scroll">
        <el-menu
          :default-active="activePath"
          class="shell-menu"
          :collapse="collapsed"
          :collapse-transition="false"
          router
        >
          <el-menu-item
            v-for="item in navItems"
            :key="item.path"
            :index="item.path"
            :title="item.label"
          >
            <span class="shell-menu__abbr">{{ item.abbr }}</span>
            <template #title>
              <span>{{ item.label }}</span>
            </template>
          </el-menu-item>
        </el-menu>
      </el-scrollbar>

      <div class="shell-aside__footer">
        <el-tag type="success" effect="light">Workspace Online</el-tag>
      </div>
    </aside>

    <div class="shell-main-wrap">
      <header class="shell-header">
        <div class="shell-header__left">
          <el-button class="shell-mobile-menu" :icon="Menu" circle @click="mobileMenuOpen = true" />
          <el-button class="shell-collapse" :icon="collapsed ? Expand : Fold" circle @click="collapsed = !collapsed" />
          <div class="shell-header__title">
            <h2>{{ activeNav?.label || "控制台" }}</h2>
            <p>{{ activeNav?.desc || "抖音内容运营管理" }}</p>
          </div>
        </div>

        <div class="shell-header__right">
          <slot name="headerActions" />
        </div>
      </header>

      <main class="shell-main">
        <section class="shell-main__hero">
          <slot name="header" />
        </section>
        <section class="shell-main__body">
          <slot />
        </section>
      </main>
    </div>

    <el-drawer v-model="mobileMenuOpen" direction="ltr" size="260px" :with-header="false">
      <div class="shell-mobile-brand">
        <p class="shell-brand__kicker">Douyin Curation Assistant</p>
        <h3>泡泡菌助手</h3>
      </div>
      <el-menu :default-active="activePath" router @select="mobileMenuOpen = false">
        <el-menu-item v-for="item in navItems" :key="item.path" :index="item.path">
          <span class="shell-menu__abbr">{{ item.abbr }}</span>
          <span>{{ item.label }}</span>
        </el-menu-item>
      </el-menu>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { Expand, Fold, Menu } from "@element-plus/icons-vue";

const route = useRoute();
const collapsed = ref(false);
const mobileMenuOpen = ref(false);

const navItems = [
  { path: "/", label: "仪表盘", desc: "全局状态与工作总览", abbr: "仪" },
  { path: "/downloads", label: "下载中心", desc: "任意链接下载与任务管理", abbr: "下" },
  { path: "/recommend-feed", label: "推荐流采集", desc: "推荐页连播与曝光采集", abbr: "推" },
  { path: "/recommend-works", label: "推荐作品库", desc: "推荐流作品与直接互动", abbr: "荐" },
  { path: "/recommend-authors", label: "推荐作者库", desc: "推荐流作者画像与快照", abbr: "荐" },
  { path: "/recommend-insights", label: "推荐分析台", desc: "推荐流关键词、话题与作者聚合", abbr: "析" },
  { path: "/keywords", label: "关键词中心", desc: "采集入口与实时日志", abbr: "词" },
  { path: "/works", label: "候选作品库", desc: "评论分析与直接互动", abbr: "作" },
  { path: "/creators", label: "候选作者库", desc: "创作者聚合与人工审核", abbr: "人" },
  { path: "/roadmap", label: "规划说明", desc: "范围边界与演进路线", abbr: "路" },
];

const activePath = computed(() => route.path || "/");

const activeNav = computed(() => {
  return navItems.find((item) => item.path === activePath.value);
});

watch(
  () => route.path,
  () => {
    mobileMenuOpen.value = false;
  }
);
</script>
