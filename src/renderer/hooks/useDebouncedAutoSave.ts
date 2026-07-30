import { useEffect, useRef } from "react";

/**
 * 修改即保存的 debounce Hook，修复切换菜单（组件卸载）时待保存数据丢失的问题。
 *
 * 工作原理：
 * 1. 当 value 非 null 时，延迟 debounceMs 再调用 saveFn 持久化。频繁变更会重置计时器。
 * 2. 当 value 为 null 时（验证失败 / 加载中 / 无变更），清除待保存标记。
 * 3. 组件卸载时不再丢弃定时器，而是立即冲刷（flush）最后一次待保存的值，
 *    确保用户在 debounce 窗口内快速切换菜单也能完成保存。
 * 4. flush 调用不依赖组件挂载状态：IPC 写入是后端异步操作，即使渲染进程
 *    已卸载该组件，后端仍会完成持久化。saveFn 内部应自行用 isMountedRef
 *    守卫跳过 React state 更新。
 *
 * @param value     待保存的值，null 表示本次无需保存
 * @param saveFn    保存函数（内部需自行守卫卸载后 state 更新）
 * @param debounceMs debounce 延迟毫秒
 */
export function useDebouncedAutoSave<T>(
  value: T | null,
  saveFn: (value: T) => void,
  debounceMs: number
): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<T | null>(null);

  // 始终保存最新的 saveFn 引用，避免闭包陈旧。
  const saveFnRef = useRef(saveFn);
  saveFnRef.current = saveFn;

  // 保存调度：value 变化时设置/清除 debounce 定时器。
  useEffect(() => {
    if (value === null) {
      // 无需保存：清除待保存标记并取消定时器。
      pendingRef.current = null;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    // 记录待保存的值。
    pendingRef.current = value;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const pending = pendingRef.current;
      if (pending !== null) {
        pendingRef.current = null;
        saveFnRef.current(pending);
      }
    }, debounceMs);
  }, [value, debounceMs]);

  // 卸载时冲刷：不丢弃待保存数据，立即触发保存。
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const pending = pendingRef.current;
      if (pending !== null) {
        pendingRef.current = null;
        // 组件已卸载，直接调用 saveFn 触发 IPC 持久化。
        // saveFn 内部的 isMountedRef 守卫会跳过 React state 更新，
        // 但 IPC 写入请求仍会被后端处理完成。
        saveFnRef.current(pending);
      }
    };
  }, []);
}
