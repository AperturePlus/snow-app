import { app } from "electron";
import { join } from "node:path";
import type { NativeBridge } from "./types";

export const loadNativeBridge = (): NativeBridge => {
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
      getCodebaseSettings: () => {
        throw new Error(
          "Rust native bridge is required to read codebase settings"
        );
      },
      upsertCodebaseSettings: () => {
        throw new Error(
          "Rust native bridge is required to write codebase settings"
        );
      },
      engineInfo: () => "Rust native bridge is not built yet",
      sum: (a: number, b: number) => a + b,
    };
  }
};

export const native = loadNativeBridge();
