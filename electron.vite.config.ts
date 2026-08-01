import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/main/index.ts"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/preload/index.ts"),
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve(__dirname, "src/renderer"),
      },
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/renderer/index.html"),
        output: {
          manualChunks: {
            // React 核心 — 首屏必需，独立 chunk 利于缓存
            "vendor-react": ["react", "react-dom"],
            // 图标库 — 体积较大但首屏需要少量图标
            "vendor-lucide": ["lucide-react"],
            // 代码高亮 — 仅 chat 消息渲染时需要
            "vendor-highlightjs": ["highlight.js"],
            // Diff 视图 — 仅右侧面板/工具调用展开时需要
            "vendor-git-diff-view": [
              "@git-diff-view/react",
              "@git-diff-view/file",
            ],
            // 终端模拟 — 仅打开终端 tab 时需要
            "vendor-xterm": ["@xterm/xterm", "@xterm/addon-fit"],
          },
        },
      },
    },
  },
});
