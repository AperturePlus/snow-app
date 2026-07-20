import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { I18nProvider } from "./i18n";
import { applyThemeCacheToDocument } from "./components/sidebar/themeSettings/themeSettingsUtils";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";

// 在 React 渲染之前同步应用 localStorage 中缓存的主题快照。
// 主题持久化在 Rust 后端，渲染进程启动时需通过 IPC 异步读取，
// 期间 CSS 变量保持默认浅色，会导致深色用户看到短暂白闪。
// 这里同步应用缓存，使首屏即呈现用户上次选择的主题。
applyThemeCacheToDocument();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>
);
