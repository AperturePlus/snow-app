import { ipcMain } from "electron";
import type { ApiModelsConfig, NativeBridge } from "../../native/types";
import {
  normalizeApiConfigInput,
  toApiConfigInput,
} from "../../settings/apiConfigs";
import { readSnowCliCodebaseSettings } from "../../settings/codebaseSettings";
import { readSnowCliProxyConfig } from "../../settings/proxyBrowserSettings";
import { readSnowCliProfiles } from "../../snowCli/profiles";

export const registerApiConfigHandlers = (native: NativeBridge): void => {
  ipcMain.handle("api-configs:list", () => native.listApiConfigs());
  ipcMain.handle("api-configs:upsert", async (_event, config: unknown) => {
    await native.upsertApiConfig(normalizeApiConfigInput(config));
    return native.listApiConfigs();
  });
  ipcMain.handle("api-configs:delete", async (_event, profileName: unknown) => {
    if (typeof profileName !== "string" || !profileName.trim()) {
      throw new Error("Profile name is required");
    }

    await native.deleteApiConfig(profileName.trim());
    return native.listApiConfigs();
  });
  ipcMain.handle("api-configs:import-snow-cli", async () => {
    const profiles = readSnowCliProfiles();

    for (const profile of profiles) {
      await native.upsertApiConfig(toApiConfigInput(profile));
    }

    return {
      importedCount: profiles.length,
      configs: await native.listApiConfigs(),
    };
  });
  ipcMain.handle("api-models:fetch", async () => {
    try {
      const models = await native.fetchAvailableModels();
      return models;
    } catch (error) {
      throw error;
    }
  });
  ipcMain.handle(
    "api-models:fetch-for-config",
    async (_event, config: unknown) => {
      if (
        typeof config !== "object" ||
        config === null ||
        Array.isArray(config)
      ) {
        throw new Error("API model config is required");
      }

      const source = config as Partial<Record<keyof ApiModelsConfig, unknown>>;
      const normalizedConfig: ApiModelsConfig = {
        baseUrl: typeof source.baseUrl === "string" ? source.baseUrl : "",
        baseUrlMode:
          typeof source.baseUrlMode === "string" ? source.baseUrlMode : "auto",
        apiKey: typeof source.apiKey === "string" ? source.apiKey : "",
        requestMethod:
          typeof source.requestMethod === "string"
            ? source.requestMethod
            : "chat",
        customHeaderSchemeId:
          typeof source.customHeaderSchemeId === "string"
            ? source.customHeaderSchemeId
            : "",
      };

      return native.fetchAvailableModelsForConfig(normalizedConfig);
    }
  );

  ipcMain.handle("proxy-browser-settings:import-snow-cli", () =>
    readSnowCliProxyConfig(native)
  );

  ipcMain.handle("codebase-settings:import-snow-cli", () =>
    readSnowCliCodebaseSettings(native)
  );
};
