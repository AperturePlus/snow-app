import { contextBridge, ipcRenderer } from "electron";

const api = {
  engineInfo: (): Promise<string> => ipcRenderer.invoke("native:engine-info"),
  sum: (a: number, b: number): Promise<number> =>
    ipcRenderer.invoke("native:sum", a, b),
};

contextBridge.exposeInMainWorld("snow", api);

export type SnowApi = typeof api;
