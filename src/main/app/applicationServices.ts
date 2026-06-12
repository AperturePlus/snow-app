import type { AppStorageInfo, NativeBridge } from "../native/types";

export const initializeApplicationServices = (
  native: NativeBridge
): AppStorageInfo => {
  const storageInfo = native.initializeAppStorage();
  console.info("Snow App storage initialized:", storageInfo.databasePath);
  return storageInfo;
};
