import { join } from "node:path";

export const isMacOS = process.platform === "darwin";
export const macTrafficLightPosition = { x: 18, y: 28 };
export const APP_ICON_PATH = join(__dirname, "../../resources/icon.png");
