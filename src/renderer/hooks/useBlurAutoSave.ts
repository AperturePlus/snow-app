import { useCallback, useEffect, useRef } from "react";

/**
 * 失焦保存 Hook：输入框失焦或即时控件变更时立即保存，避免边输入边保存打断输入。
 *
 * 工作原理：
 * 1. `commit` 读取最新的 form/validate/toSettings/lastSaved（通过 ref 持有最新引用，
 *    不依赖 render 闭包），校验通过且与 lastSaved 不同时立即调用 saveFn 持久化。
 * 2. 文本/数字输入框在 onBlur 时调用 commit；checkbox / select / combobox 等
 *    即时控件在 onChange 后调用 commit（它们没有失焦语义，变更即应保存）。
 * 3. 组件卸载时若仍有未保存的脏数据，立即冲刷，避免切换菜单丢失。
 *
 * 与 useDebouncedAutoSave 的区别：不使用定时器，完全由失焦/变更事件驱动，
 * 输入过程中不会触发保存，彻底消除“输入到一半被定时器打断”的问题。
 *
 * @param form         当前表单值
 * @param validate     校验函数，返回错误消息或 null
 * @param toSettings   将表单转换为持久化设置对象
 * @param lastSaved    上次保存的设置，用于判断是否有变更
 * @param saveFn       保存函数（内部需自行守卫卸载后 state 更新）
 * @param setError     设置错误提示（校验失败时调用）
 */
export function useBlurAutoSave<TForm, TSettings>(
  form: TForm,
  validate: (form: TForm) => string | null,
  toSettings: (form: TForm) => TSettings,
  lastSaved: TSettings,
  saveFn: (settings: TSettings) => void,
  setError: (updater: (prev: string) => string) => void
): () => void {
  // 始终持有最新的引用，避免闭包陈旧。
  const formRef = useRef(form);
  const validateRef = useRef(validate);
  const toSettingsRef = useRef(toSettings);
  const lastSavedRef = useRef(lastSaved);
  const saveFnRef = useRef(saveFn);
  const setErrorRef = useRef(setError);
  const isMountedRef = useRef(true);

  formRef.current = form;
  validateRef.current = validate;
  toSettingsRef.current = toSettings;
  lastSavedRef.current = lastSaved;
  saveFnRef.current = saveFn;
  setErrorRef.current = setError;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const commit = useCallback(() => {
    const currentForm = formRef.current;
    const validationError = validateRef.current(currentForm);

    if (validationError) {
      setErrorRef.current((prev) =>
        prev === validationError ? prev : validationError
      );
      return;
    }

    setErrorRef.current((prev) => (prev === "" ? prev : ""));

    const settings = toSettingsRef.current(currentForm);
    if (JSON.stringify(settings) === JSON.stringify(lastSavedRef.current)) {
      return;
    }

    // saveFn 内部会更新 lastSaved，因此无需在此维护 pending 状态。
    saveFnRef.current(settings);
  }, []);

  // 卸载时冲刷：若仍有未保存的脏数据，立即触发保存，避免切换菜单丢失。
  useEffect(() => {
    return () => {
      const currentForm = formRef.current;
      const validationError = validateRef.current(currentForm);
      if (validationError) {
        return;
      }
      const settings = toSettingsRef.current(currentForm);
      if (JSON.stringify(settings) === JSON.stringify(lastSavedRef.current)) {
        return;
      }
      // 组件已卸载，直接调用 saveFn 触发 IPC 持久化。
      // saveFn 内部的 isMountedRef 守卫会跳过 React state 更新，
      // 但 IPC 写入请求仍会被后端处理完成。
      saveFnRef.current(settings);
    };
  }, []);

  return commit;
}
