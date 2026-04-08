const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api/v1";

function buildQueryString(params = {}) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    searchParams.set(key, value);
  }

  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const error = new Error(
      errorBody.error || `Request failed: ${response.status}`
    );
    error.code = errorBody.code || "";
    error.details = errorBody.details || null;
    throw error;
  }

  return response.json();
}

export const api = {
  getHealth() {
    return request("/health");
  },
  getWorkAnalysis(workId) {
    return request(`/analysis/works/${workId}`);
  },
  runWorkAnalysis(workId, payload) {
    return request(`/analysis/works/${workId}/run`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  runBatchAnalysis(payload) {
    return request("/analysis/works/run-batch", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  getBrowserSession(params = {}) {
    return request(`/browser-session${buildQueryString(params)}`);
  },
  prepareBrowserSession(payload = {}) {
    return request("/browser-session", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  resetBrowserSession(profileKey = "runtime") {
    return request(`/browser-session${buildQueryString({ profileKey })}`, {
      method: "DELETE",
    });
  },
  getDashboard() {
    return request("/dashboard");
  },
  resolveDownloadSource(payload) {
    return request("/download/resolve-source", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  getDownloadTasks(params = {}) {
    return request(`/download/tasks${buildQueryString(params)}`);
  },
  createDownloadTask(payload) {
    return request("/download/tasks", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  getDownloadTask(taskId) {
    return request(`/download/tasks/${taskId}`);
  },
  getDownloadedAssets(taskId) {
    return request(`/download/tasks/${taskId}/files`);
  },
  retryDownloadTask(taskId) {
    return request(`/download/tasks/${taskId}/retry`, {
      method: "POST",
    });
  },
  getContinuousDiscoveryStatus() {
    return request("/discovery/continuous");
  },
  startContinuousDiscovery(payload) {
    return request("/discovery/continuous/start", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  stopContinuousDiscovery() {
    return request("/discovery/continuous/stop", {
      method: "POST",
    });
  },
  getContinuousDiscoveryStreamUrl() {
    return `${API_BASE_URL}/discovery/continuous/stream`;
  },
  getRecommendFeedStatus() {
    return request("/discovery/recommend");
  },
  startRecommendFeed(payload) {
    return request("/discovery/recommend/start", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  stopRecommendFeed() {
    return request("/discovery/recommend/stop", {
      method: "POST",
    });
  },
  getRecommendFeedStreamUrl() {
    return `${API_BASE_URL}/discovery/recommend/stream`;
  },
  getRecommendRuns(params = {}) {
    return request(`/discovery/recommend/runs${buildQueryString(params)}`);
  },
  getRecommendRun(runId) {
    return request(`/discovery/recommend/runs/${runId}`);
  },
  getRecommendRunExposures(runId, params = {}) {
    return request(
      `/discovery/recommend/runs/${runId}/exposures${buildQueryString(params)}`
    );
  },
  deleteRecommendRun(runId) {
    return request(`/discovery/recommend/runs/${runId}`, {
      method: "DELETE",
    });
  },
  getRecommendWorks(params = {}) {
    return request(`/recommend/works${buildQueryString(params)}`);
  },
  getRecommendWorkDetail(workId) {
    return request(`/recommend/works/${workId}`);
  },
  executeRecommendWorkDirectAction(workId, payload = {}) {
    return request(`/recommend/works/${workId}/direct-action`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  batchDeleteRecommendWorks(payload) {
    return request("/recommend/works/batch-delete", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  getRecommendAuthors(params = {}) {
    return request(`/recommend/authors${buildQueryString(params)}`);
  },
  getRecommendAuthorDetail(authorId) {
    return request(`/recommend/authors/${authorId}`);
  },
  getRecommendInsights(params = {}) {
    return request(`/recommend/insights${buildQueryString(params)}`);
  },
  getKeywords() {
    return request("/keywords");
  },
  createKeyword(payload) {
    return request("/keywords", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  updateKeyword(keywordId, payload) {
    return request(`/keywords/${keywordId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },
  deleteKeyword(keywordId) {
    return request(`/keywords/${keywordId}`, {
      method: "DELETE",
    });
  },
  discoverKeyword(keywordId, payload) {
    return request(`/keywords/${keywordId}/discover`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  getWorks(params = {}) {
    return request(`/works${buildQueryString(params)}`);
  },
  executeWorkDirectAction(workId, payload = {}) {
    return request(`/works/${workId}/direct-action`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  batchDeleteWorks(payload) {
    return request("/works/batch-delete", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  getCreatorCandidates(params = {}) {
    return request(`/creator-candidates${buildQueryString(params)}`);
  },
  rebuildCreatorCandidates(payload) {
    return request("/creator-candidates/rebuild", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  updateCreatorCandidate(creatorId, payload) {
    return request(`/creator-candidates/${creatorId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },
  getRoadmap() {
    return request("/roadmap");
  },
};
