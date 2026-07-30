import { useCallback, useEffect, useRef } from "react";

/**
 * 失焦保存 Hook：输入框真正失焦或即时控件完成选择时立即保存，避免边输入边保存打断输入。
 *
 * 工作原理：
 * 1. `commit(nextForm?)` 校验并持久化表单。不传参时读取最新的 form（通过 ref 持有，
 *    不依赖 render 闭包）；传入 nextForm 时直接使用该值——用于下拉选择等场景，
 *    此时 setState 尚未重渲染，ref 中的 form 仍是旧值，必须显式传入新表单才能保存选中结果。
 * 2. 文本/数字输入框在真正 onBlur 时调用 commit（焦点移入同组下拉控件不算失焦，
 *    由调用方守卫）；select / combobox 等即时控件在完成选择后携带新值调用 commit。
 * 3. 组件卸载时若仍有未保存的脏数据，立即冲刷，避免切换菜单丢失。
 *
 * 与 useDebouncedAutoSave 的区别：不使用定时器，完全由失焦/选择事件驱动，
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
): (nextForm?: TForm) => void {
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

  const commit = useCallback((nextForm?: TForm) => {
    const currentForm = nextForm ?? formRef.current;
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
