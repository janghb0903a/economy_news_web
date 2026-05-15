const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("controlApi", {
  initialState: () => ipcRenderer.invoke("initial-state"),
  choosePath: () => ipcRenderer.invoke("choose-path"),
  run: (action, installPath) => ipcRenderer.invoke("run-control", action, installPath),
  openLog: () => ipcRenderer.invoke("open-log"),
  logLines: () => ipcRenderer.invoke("log-lines"),
  openUrl: () => ipcRenderer.invoke("open-url"),
  onLogUpdate: (callback) => {
    ipcRenderer.removeAllListeners("log-update");
    ipcRenderer.on("log-update", (_event, lines) => callback(lines));
  }
});
