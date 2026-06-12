import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  shell,
} from "electron";
import { is } from "@electron-toolkit/utils";

type AppStorageInfo = {
  directoryPath: string;
  databasePath: string;
};

type ApiConfigInput = {
  profileName: string;
  displayName: string;
  isActive: boolean;
  baseUrl: string;
  baseUrlMode: string;
  apiKey: string;
  requestMethod: string;
  advancedModel: string;
  basicModel: string;
  supportsVision: boolean;
  visionBaseUrl: string;
  visionBaseUrlMode: string;
  visionApiKey: string;
  visionRequestMethod: string;
  visionModel: string;
  maxContextTokens?: number | null;
  maxTokens?: number | null;
  streamIdleTimeoutSec?: number | null;
  configJson: string;
  source: string;
};

type ApiConfigRecord = Omit<
  ApiConfigInput,
  "visionBaseUrlMode" | "configJson"
> & {
  id: number;
  updatedAt: string;
};

type SnowCliProfile = {
  name: string;
  config: Record<string, unknown>;
  isActive: boolean;
};

type NativeBridge = {
  initializeAppStorage: () => AppStorageInfo;
  getSystemSettingValue: (settingCode: string) => string | null;
  setSystemSetting: (
    settingName: string,
    settingCode: string,
    settingValue: string
  ) => void;
  listApiConfigs: () => ApiConfigRecord[];
  upsertApiConfig: (config: ApiConfigInput) => void;
  deleteApiConfig: (profileName: string) => void;
  engineInfo: () => string;
  sum: (a: number, b: number) => number;
};

const loadNativeBridge = (): NativeBridge => {
  try {
    const nativeEntry = join(app.getAppPath(), "native", "index.cjs");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(nativeEntry) as NativeBridge;
  } catch (error) {
    console.warn(
      "Native Rust bridge is unavailable, using development fallback.",
      error
    );

    return {
      initializeAppStorage: () => {
        throw new Error(
          "Rust native bridge is required to initialize Snow App storage"
        );
      },
      getSystemSettingValue: () => {
        throw new Error(
          "Rust native bridge is required to read system settings"
        );
      },
      setSystemSetting: () => {
        throw new Error(
          "Rust native bridge is required to write system settings"
        );
      },
      listApiConfigs: () => {
        throw new Error("Rust native bridge is required to list API configs");
      },
      upsertApiConfig: () => {
        throw new Error("Rust native bridge is required to write API configs");
      },
      deleteApiConfig: () => {
        throw new Error("Rust native bridge is required to delete API configs");
      },
      engineInfo: () => "Rust native bridge is not built yet",
      sum: (a: number, b: number) => a + b,
    };
  }
};

const native = loadNativeBridge();
const isMacOS = process.platform === "darwin";
const macTrafficLightPosition = { x: 18, y: 28 };
const APP_ICON_PATH = join(__dirname, "../../resources/icon.png");

const SNOW_CLI_CONFIG_DIR = join(homedir(), ".snow");
const SNOW_CLI_PROFILES_DIR = join(SNOW_CLI_CONFIG_DIR, "profiles");
const SNOW_CLI_ACTIVE_PROFILE_FILE = join(
  SNOW_CLI_CONFIG_DIR,
  "active-profile.json"
);
const SNOW_CLI_LEGACY_ACTIVE_PROFILE_FILE = join(
  SNOW_CLI_CONFIG_DIR,
  "active-profile.txt"
);
const SNOW_CLI_LEGACY_CONFIG_FILE = join(SNOW_CLI_CONFIG_DIR, "config.json");

const getWindowBackgroundColor = (): string =>
  nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readJsonFile = (filePath: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
};

const getActiveSnowCliProfileName = (): string => {
  const activeProfileData = existsSync(SNOW_CLI_ACTIVE_PROFILE_FILE)
    ? readJsonFile(SNOW_CLI_ACTIVE_PROFILE_FILE)
    : null;

  if (typeof activeProfileData?.activeProfile === "string") {
    return activeProfileData.activeProfile;
  }

  if (existsSync(SNOW_CLI_LEGACY_ACTIVE_PROFILE_FILE)) {
    try {
      return readFileSync(SNOW_CLI_LEGACY_ACTIVE_PROFILE_FILE, "utf8").trim();
    } catch {
      return "default";
    }
  }

  return "default";
};

const readSnowCliProfiles = (): SnowCliProfile[] => {
  const activeProfileName = getActiveSnowCliProfileName();
  const profiles: SnowCliProfile[] = [];

  if (existsSync(SNOW_CLI_PROFILES_DIR)) {
    for (const fileName of readdirSync(SNOW_CLI_PROFILES_DIR)) {
      if (!fileName.endsWith(".json")) {
        continue;
      }

      const profileName = fileName.replace(/\.json$/, "");
      const config = readJsonFile(join(SNOW_CLI_PROFILES_DIR, fileName));

      if (config) {
        profiles.push({
          name: profileName,
          config,
          isActive: profileName === activeProfileName,
        });
      }
    }
  }

  if (profiles.length === 0 && existsSync(SNOW_CLI_LEGACY_CONFIG_FILE)) {
    const config = readJsonFile(SNOW_CLI_LEGACY_CONFIG_FILE);

    if (config) {
      profiles.push({ name: "default", config, isActive: true });
    }
  }

  return profiles.sort((a, b) => a.name.localeCompare(b.name));
};

const toText = (value: unknown, defaultValue = ""): string =>
  typeof value === "string" ? value : defaultValue;

const toIntegerOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;

const toBoolean = (value: unknown, defaultValue: boolean): boolean =>
  typeof value === "boolean" ? value : defaultValue;

const toApiConfigInput = (profile: SnowCliProfile): ApiConfigInput => {
  const snowcfg = isRecord(profile.config.snowcfg)
    ? profile.config.snowcfg
    : {};

  return {
    profileName: profile.name,
    displayName: profile.name,
    isActive: profile.isActive,
    baseUrl: toText(snowcfg.baseUrl, "https://api.openai.com/v1"),
    baseUrlMode: toText(snowcfg.baseUrlMode, "auto"),
    apiKey: toText(snowcfg.apiKey),
    requestMethod: toText(snowcfg.requestMethod, "chat"),
    advancedModel: toText(snowcfg.advancedModel),
    basicModel: toText(snowcfg.basicModel),
    supportsVision: toBoolean(snowcfg.supportsVision, true),
    visionBaseUrl: toText(snowcfg.visionBaseUrl),
    visionBaseUrlMode: toText(snowcfg.visionBaseUrlMode, "auto"),
    visionApiKey: toText(snowcfg.visionApiKey),
    visionRequestMethod: toText(snowcfg.visionRequestMethod, "chat"),
    visionModel: toText(snowcfg.visionModel),
    maxContextTokens: toIntegerOrNull(snowcfg.maxContextTokens),
    maxTokens: toIntegerOrNull(snowcfg.maxTokens),
    streamIdleTimeoutSec: toIntegerOrNull(snowcfg.streamIdleTimeoutSec),
    configJson: JSON.stringify(profile.config),
    source: "snow-cli",
  };
};

const normalizeApiConfigInput = (value: unknown): ApiConfigInput => {
  if (!isRecord(value)) {
    throw new Error("API config payload must be an object");
  }

  const profileName = toText(value.profileName).trim();

  if (!profileName) {
    throw new Error("Profile name is required");
  }

  const displayName =
    toText(value.displayName, profileName).trim() || profileName;
  const baseUrl =
    toText(value.baseUrl, "https://api.openai.com/v1").trim() ||
    "https://api.openai.com/v1";
  const requestMethod = toText(value.requestMethod, "chat").trim() || "chat";
  const advancedModel = toText(value.advancedModel).trim();
  const basicModel = toText(value.basicModel).trim();
  const supportsVision = toBoolean(value.supportsVision, true);
  const visionBaseUrl = toText(value.visionBaseUrl).trim();
  const visionModel = toText(value.visionModel).trim();
  const source = toText(value.source, "manual").trim() || "manual";
  const visionRequestMethod =
    toText(value.visionRequestMethod, requestMethod).trim() || requestMethod;
  const manualConfig = {
    snowcfg: {
      baseUrl,
      baseUrlMode: toText(value.baseUrlMode, "custom"),
      requestMethod,
      advancedModel,
      basicModel,
      supportsVision,
      visionBaseUrl,
      visionBaseUrlMode: toText(value.visionBaseUrlMode, "auto"),
      visionRequestMethod,
      visionModel,
      maxContextTokens: toIntegerOrNull(value.maxContextTokens) ?? undefined,
      maxTokens: toIntegerOrNull(value.maxTokens) ?? undefined,
      streamIdleTimeoutSec:
        toIntegerOrNull(value.streamIdleTimeoutSec) ?? undefined,
      source,
    },
  };

  return {
    profileName,
    displayName,
    isActive: toBoolean(value.isActive, false),
    baseUrl,
    baseUrlMode: toText(value.baseUrlMode, "custom"),
    apiKey: toText(value.apiKey),
    requestMethod,
    advancedModel,
    basicModel,
    supportsVision,
    visionBaseUrl,
    visionBaseUrlMode: toText(value.visionBaseUrlMode, "auto"),
    visionApiKey: toText(value.visionApiKey),
    visionRequestMethod,
    visionModel,
    maxContextTokens: toIntegerOrNull(value.maxContextTokens) ?? undefined,
    maxTokens: toIntegerOrNull(value.maxTokens) ?? undefined,
    streamIdleTimeoutSec:
      toIntegerOrNull(value.streamIdleTimeoutSec) ?? undefined,
    configJson: toText(value.configJson, JSON.stringify(manualConfig)),
    source,
  };
};

const initializeApplicationServices = (): AppStorageInfo => {
  const storageInfo = native.initializeAppStorage();
  console.info("Snow App storage initialized:", storageInfo.databasePath);
  return storageInfo;
};

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: "Snow App",
    icon: APP_ICON_PATH,
    titleBarStyle: isMacOS ? "hidden" : "default",
    ...(isMacOS ? { trafficLightPosition: macTrafficLightPosition } : {}),
    autoHideMenuBar: true,
    backgroundColor: getWindowBackgroundColor(),
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenu(null);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setAutoHideMenuBar(true);

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (is.dev && input.key === "F12") {
      event.preventDefault();
      mainWindow.webContents.toggleDevTools();
      return;
    }

    if (
      input.key === "Alt" ||
      input.code === "AltLeft" ||
      input.code === "AltRight"
    ) {
      event.preventDefault();
    }
  });

  nativeTheme.on("updated", () => {
    mainWindow.setBackgroundColor(getWindowBackgroundColor());
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch((error) => {
      console.error("Failed to open external URL:", error);
    });

    return { action: "deny" };
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL).catch((error) => {
      console.error("Failed to load development renderer URL:", error);
    });
  } else {
    mainWindow
      .loadURL(
        pathToFileURL(join(__dirname, "../renderer/index.html")).toString()
      )
      .catch((error) => {
        console.error("Failed to load packaged renderer:", error);
      });
  }
};

app.whenReady().then(() => {
  initializeApplicationServices();

  Menu.setApplicationMenu(null);
  nativeTheme.themeSource = "system";

  if (isMacOS && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(APP_ICON_PATH));
  }

  ipcMain.handle("native:engine-info", () => native.engineInfo());
  ipcMain.handle(
    "settings:get-system-setting-value",
    (_event, settingCode: string) => native.getSystemSettingValue(settingCode)
  );
  ipcMain.handle(
    "settings:set-system-setting",
    (_event, settingName: string, settingCode: string, settingValue: string) =>
      native.setSystemSetting(settingName, settingCode, settingValue)
  );
  ipcMain.handle("api-configs:list", () => native.listApiConfigs());
  ipcMain.handle("api-configs:upsert", (_event, config: unknown) => {
    native.upsertApiConfig(normalizeApiConfigInput(config));
    return native.listApiConfigs();
  });
  ipcMain.handle("api-configs:delete", (_event, profileName: unknown) => {
    if (typeof profileName !== "string" || !profileName.trim()) {
      throw new Error("Profile name is required");
    }

    native.deleteApiConfig(profileName.trim());
    return native.listApiConfigs();
  });
  ipcMain.handle("api-configs:import-snow-cli", () => {
    const profiles = readSnowCliProfiles();

    for (const profile of profiles) {
      native.upsertApiConfig(toApiConfigInput(profile));
    }

    return {
      importedCount: profiles.length,
      configs: native.listApiConfigs(),
    };
  });
  ipcMain.handle("native:sum", (_event, a: number, b: number) =>
    native.sum(a, b)
  );

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
