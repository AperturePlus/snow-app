import type { TaskManagerProcess } from "../../../preload";
import type { summarizeProcesses } from "./taskManagerModel";

export const formatTaskBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MiB`;
  return `${(bytes / 1073741824).toFixed(2)} GiB`;
};
export const formatTaskCpu = (percent: number): string =>
  percent < 0 ? "—" : `${percent.toFixed(1)}%`;
export const taskDisplayName = (process: TaskManagerProcess): string =>
  process.title || process.serviceName || process.name;
export const taskProjectName = (root: string): string =>
  root
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() || root;
export const formatTaskTotalCpu = (
  value: ReturnType<typeof summarizeProcesses>,
): string =>
  value.cpuSamples
    ? `${value.cpu.toFixed(1)}%${value.cpuSamples < value.count ? " *" : ""}`
    : "—";
