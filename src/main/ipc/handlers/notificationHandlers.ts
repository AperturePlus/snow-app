import { ipcMain } from "electron";
import {
  showAppNotification,
  type AppNotificationOptions,
} from "../../notification/notificationManager";

export const registerNotificationHandlers = (): void => {
  ipcMain.handle("notification:show", (_event, options: unknown) => {
    if (
      !options ||
      typeof options !== "object" ||
      typeof (options as AppNotificationOptions).title !== "string" ||
      typeof (options as AppNotificationOptions).body !== "string"
    ) {
      return;
    }

    showAppNotification(options as AppNotificationOptions);
  });
};
