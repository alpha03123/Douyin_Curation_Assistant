import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.VITE_DEV_PROXY_TARGET || "http://localhost:3001";

  return {
    plugins: [vue()],
    server: {
      port: 5173,
      host: true,
      strictPort: true,
      proxy: {
        "/api/v1": {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
