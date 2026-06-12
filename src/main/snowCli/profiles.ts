import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJsonFile } from "../utils/jsonFile";
import {
  SNOW_CLI_ACTIVE_PROFILE_FILE,
  SNOW_CLI_LEGACY_ACTIVE_PROFILE_FILE,
  SNOW_CLI_LEGACY_CONFIG_FILE,
  SNOW_CLI_PROFILES_DIR,
} from "./paths";

export type SnowCliProfile = {
  name: string;
  config: Record<string, unknown>;
  isActive: boolean;
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

export const readSnowCliProfiles = (): SnowCliProfile[] => {
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
