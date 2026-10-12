/** 应用任务管理器：单个进程的占用快照（主进程合并 Rust 事实与 Electron 语义）。 */
export type TaskManagerProcessKind =
  "browser" | "renderer" | "gpu" | "utility" | "child";

export type TaskManagerProcess = {
  pid: number;
  parentPid: number;
  /** 可执行文件名（不含路径） */
  name: string;
  /** 可执行文件完整路径；取不到时为空串 */
  exePath: string;
  /** 系统图标（data URL）；取不到时为 null，由前端回退到通用图标 */
  iconDataUrl: string | null;
  kind: TaskManagerProcessKind;
  /** Utility 进程的服务名（如 "Network Service"），其它进程为空串 */
  serviceName: string;
  /** 渲染进程所属页面的标题，其它进程为空串 */
  title: string;
  /** 渲染进程所属页面的 URL，其它进程为空串 */
  url: string;
  /** CPU 占用百分比（按整机逻辑处理器数归一化，跑满全部核心 = 100；-1 表示本次无基线） */
  cpuPercent: number;
  memoryBytes: number;
  threadCount: number;
  /** 是否允许结束：Electron 自身进程只展示，应用派生的子进程可结束 */
  killable: boolean;
};
