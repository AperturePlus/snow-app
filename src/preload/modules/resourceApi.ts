import { ipcRenderer } from "electron";
import type { MemoryOptimizeResult } from "../types/storage";
import type { TaskManagerProcess } from "../types/taskManager";

/** 应用资源占用查询 API。 */
export const resourceApi = {
  /** 应用任务管理器：采集应用进程树占用快照（CPU 为相对上次调用的增量） */
  getProcessSnapshot: (): Promise<TaskManagerProcess[]> =>
    ipcRenderer.invoke("processes:snapshot"),

  /** 结束指定子进程树（Electron 自身进程会被主进程拒绝） */
  killProcessTree: (pid: number): Promise<void> =>
    ipcRenderer.invoke("processes:kill", pid),

  /** 整理本进程内存（仅 Windows 支持；其它平台快速失败），返回整理前后常驻内存 */
  optimizeMemory: (): Promise<MemoryOptimizeResult> =>
    ipcRenderer.invoke("settings:optimize-memory"),

  /** 清空应用 HTTP 缓存并强制重新加载界面 */
  clearAppCacheAndReload: (): Promise<void> =>
    ipcRenderer.invoke("app:clear-cache-and-reload"),
};
