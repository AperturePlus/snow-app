import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type {
  KeyboardShortcutAction,
  KeyboardShortcutConfig,
  KeyboardShortcutsSettings,
} from "../../preload";

/**
 * 所有快捷键的默认配置。当后端尚未 seed 或读取失败时使用。
 * 6 个快捷键全部默认 enabled=true, foregroundOnly=true。
 */
const DEFAULT_SETTINGS: KeyboardShortcutsSettings = {
  cancelSession: { key: "escape", enabled: true, foregroundOnly: true },
  openSearch: { key: "mod+f", enabled: true, foregroundOnly: true },
  openMemo: { key: "mod+b", enabled: true, foregroundOnly: true },
  openTodo: { key: "mod+t", enabled: true, foregroundOnly: true },
  cycleProject: { key: "mod+backtick", enabled: true, foregroundOnly: true },
  openProjectExplorer: { key: "mod+d", enabled: true, foregroundOnly: true },
};

/**
 * 快捷键动作处理器类型。每个动作对应一个无参回调。
 * 当快捷键触发且 enabled=true 时调用。
 */
export type KeyboardShortcutHandler = () => void;

type KeyboardShortcutsContextValue = {
  /** 当前快捷键设置（内存缓存，启动时从 SQLite 加载） */
  settings: KeyboardShortcutsSettings;
  /** 是否已从后端加载完成 */
  isLoaded: boolean;
  /** 更新单个快捷键的配置，同时写入 SQLite 和内存缓存 */
  updateShortcutConfig: (
    action: KeyboardShortcutAction,
    config: Partial<KeyboardShortcutConfig>
  ) => void;
  /** 注册某个动作的处理器。返回注销函数。 */
  registerHandler: (
    action: KeyboardShortcutAction,
    handler: KeyboardShortcutHandler
  ) => () => void;
  /** 获取某个动作的当前处理器（通过 ref，避免闭包过期） */
  getHandler: (action: KeyboardShortcutAction) => KeyboardShortcutHandler | null;
};

const KeyboardShortcutsContext = createContext<
  KeyboardShortcutsContextValue | undefined
>(undefined);

export const KeyboardShortcutsProvider = ({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element => {
  const [settings, setSettings] = useState<KeyboardShortcutsSettings>(
    DEFAULT_SETTINGS
  );
  const [isLoaded, setIsLoaded] = useState(false);

  // 处理器注册表：action -> handler。使用 ref 持有最新值，
  // 这样 keydown 监听器读取时不会因闭包过期而调用旧 handler。
  const handlersRef = useRef<
    Map<KeyboardShortcutAction, KeyboardShortcutHandler>
  >(new Map());

  // 设置的 ref 镜像，keydown 监听器通过它读取最新设置，
  // 避免每次设置变化都重新注册 keydown listener。
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // 启动时从 SQLite 加载快捷键设置到内存缓存
  useEffect(() => {
    let cancelled = false;
    void window.snow
      .getKeyboardShortcutsSettings()
      .then((loaded) => {
        if (!cancelled) {
          setSettings(loaded);
          setIsLoaded(true);
        }
      })
      .catch(() => {
        // 读取失败时使用默认值，不阻塞应用启动
        if (!cancelled) {
          setSettings(DEFAULT_SETTINGS);
          setIsLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateShortcutConfig = useCallback(
    (
      action: KeyboardShortcutAction,
      config: Partial<KeyboardShortcutConfig>
    ) => {
      setSettings((prev: KeyboardShortcutsSettings) => {
        const current = prev[action];
        const next: KeyboardShortcutsSettings = {
          ...prev,
          [action]: { ...current, ...config },
        };
        // 双写：异步写入 SQLite，不阻塞 UI
        void window.snow.setKeyboardShortcutsSettings(next).catch(() => {
          // 写入失败时静默处理，内存缓存仍已更新
        });
        return next;
      });
    },
    []
  );

  const registerHandler = useCallback(
    (action: KeyboardShortcutAction, handler: KeyboardShortcutHandler) => {
      handlersRef.current.set(action, handler);
      return () => {
        // 仅在 handler 未被替换时才删除，避免新 handler 被误删
        if (handlersRef.current.get(action) === handler) {
          handlersRef.current.delete(action);
        }
      };
    },
    []
  );

  const getHandler = useCallback(
    (action: KeyboardShortcutAction): KeyboardShortcutHandler | null => {
      return handlersRef.current.get(action) ?? null;
    },
    []
  );

  const value: KeyboardShortcutsContextValue = {
    settings,
    isLoaded,
    updateShortcutConfig,
    registerHandler,
    getHandler,
  };

  return (
    <KeyboardShortcutsContext.Provider value={value}>
      {children}
    </KeyboardShortcutsContext.Provider>
  );
};

export const useKeyboardShortcutsSettings =
  (): KeyboardShortcutsContextValue => {
    const context = useContext(KeyboardShortcutsContext);
    if (!context) {
      throw new Error(
        "useKeyboardShortcutsSettings must be used within a KeyboardShortcutsProvider"
      );
    }
    return context;
  };

/**
 * 获取当前设置的 ref，供 keydown 监听器同步读取最新值。
 * 避免在 keydown callback 闭包中捕获过期的 settings。
 */
export const useKeyboardShortcutsSettingsRef = ():
  React.MutableRefObject<KeyboardShortcutsSettings> => {
  const { settings } = useKeyboardShortcutsSettings();
  const ref = useRef(settings);
  ref.current = settings;
  return ref;
};
