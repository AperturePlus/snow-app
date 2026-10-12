// Linux AppImage 的运行时会把 ARGV0 注入进程环境；zsh 会用导出的 ARGV0 作为
// 它启动的每个外部命令的 argv[0]，于是子进程（python 等）误认为自己是 AppImage，
// sys.executable 指向 AppImage、venv 失效。ELECTRON_RUN_AS_NODE 同属启动器/宿主
// 实现细节（与 PTY 侧过滤列表同源），泄漏后子进程按 Node 语义解释自身。
// 启动时从共享环境里剔除，所有子进程（Rust spawn、PTY、node spawn）都不再继承。
const LAUNCHER_INJECTED_ENV_KEYS = ["ARGV0", "ELECTRON_RUN_AS_NODE"];

export const sanitizeLauncherEnvironment = (): void => {
  for (const key of LAUNCHER_INJECTED_ENV_KEYS) {
    if (process.env[key] !== undefined) {
      delete process.env[key];
    }
  }
};
