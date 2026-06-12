import { homedir } from "node:os";
import { join } from "node:path";

export const SNOW_CLI_CONFIG_DIR = join(homedir(), ".snow");
export const SNOW_CLI_PROFILES_DIR = join(SNOW_CLI_CONFIG_DIR, "profiles");
export const SNOW_CLI_ACTIVE_PROFILE_FILE = join(
  SNOW_CLI_CONFIG_DIR,
  "active-profile.json"
);
export const SNOW_CLI_LEGACY_ACTIVE_PROFILE_FILE = join(
  SNOW_CLI_CONFIG_DIR,
  "active-profile.txt"
);
export const SNOW_CLI_LEGACY_CONFIG_FILE = join(
  SNOW_CLI_CONFIG_DIR,
  "config.json"
);
export const SNOW_CLI_PROXY_CONFIG_FILE = join(
  SNOW_CLI_CONFIG_DIR,
  "proxy-config.json"
);
export const SNOW_CLI_GLOBAL_SETTINGS_FILE = join(
  SNOW_CLI_CONFIG_DIR,
  "settings.json"
);
export const SNOW_CLI_PROJECT_SETTINGS_FILE = join(
  process.cwd(),
  ".snow",
  "settings.json"
);
