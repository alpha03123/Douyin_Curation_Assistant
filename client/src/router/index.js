import { createRouter, createWebHistory } from "vue-router";
import DashboardView from "../views/DashboardView.vue";
import DownloadsView from "../views/DownloadsView.vue";
import CreatorsView from "../views/CreatorsView.vue";
import KeywordsView from "../views/KeywordsView.vue";
import RecommendAuthorsView from "../views/RecommendAuthorsView.vue";
import RecommendFeedView from "../views/RecommendFeedView.vue";
import RecommendInsightsView from "../views/RecommendInsightsView.vue";
import RecommendWorksDirectView from "../views/RecommendWorksDirectView.vue";
import RoadmapView from "../views/RoadmapView.vue";
import WorksDirectView from "../views/WorksDirectView.vue";

const routes = [
  { path: "/", name: "dashboard", component: DashboardView },
  { path: "/downloads", name: "downloads", component: DownloadsView },
  { path: "/keywords", name: "keywords", component: KeywordsView },
  { path: "/recommend-feed", name: "recommend-feed", component: RecommendFeedView },
  { path: "/recommend-works", name: "recommend-works", component: RecommendWorksDirectView },
  { path: "/recommend-authors", name: "recommend-authors", component: RecommendAuthorsView },
  { path: "/recommend-insights", name: "recommend-insights", component: RecommendInsightsView },
  { path: "/works", name: "works", component: WorksDirectView },
  { path: "/creators", name: "creators", component: CreatorsView },
  { path: "/roadmap", name: "roadmap", component: RoadmapView },
  { path: "/action-rules", redirect: "/works" },
  { path: "/templates", redirect: "/works" },
  { path: "/dictionary", redirect: "/works" },
  { path: "/review", redirect: "/works" },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
