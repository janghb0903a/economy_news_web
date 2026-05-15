const { app, BrowserWindow, dialog, ipcMain, screen, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const controlRoot = __dirname;
const appRoot = path.dirname(controlRoot);
const python = path.join(appRoot, "runtime", "python", "python.exe");
const controlPy = path.join(appRoot, "tools", "control.py");
const stateFile = path.join(appRoot, ".runtime", "install-target.json");
const defaultInstallPath = "C:\\EconomyNewsDashboard";
const logLines = [];
let mainWindow = null;
let logWindow = null;
let allowClose = false;

function controlLogPath() {
  const installPath = readInstallPath();
  return fs.existsSync(installPath)
    ? path.join(installPath, "logs", "control.log")
    : path.join(appRoot, "logs", "control.log");
}

function appendLog(line) {
  const text = String(line || "").trim();
  if (!text) return;
  const stamped = `[${new Date().toLocaleTimeString("ko-KR", { hour12: false })}] ${text}`;
  logLines.push(stamped);
  while (logLines.length > 500) logLines.shift();
  try {
    const logPath = controlLogPath();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${stamped}\n`, "utf8");
  } catch {
    // Logging should never block the control app.
  }
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send("log-update", logLines);
  });
}

function readInstallPath() {
  try {
    const data = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return data.install_path || defaultInstallPath;
  } catch {
    return defaultInstallPath;
  }
}

function normalizeInstallPath(selected) {
  if (!selected) return defaultInstallPath;
  return path.basename(selected).toLowerCase() === "economynewsdashboard" ? selected : path.join(selected, "EconomyNewsDashboard");
}

function control(args, options = {}) {
  return new Promise((resolve) => {
    const shouldLog = options.log !== false;
    if (shouldLog) appendLog(`> control.py ${args.join(" ")}`);
    const child = spawn(python, ["-u", controlPy, ...args], {
      cwd: appRoot,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1"
      }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (shouldLog) text.split(/\r?\n/).forEach(appendLog);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (shouldLog) text.split(/\r?\n/).forEach(appendLog);
    });
    child.on("close", (code) => {
      const output = `${stdout}${stderr}`.trim();
      if (shouldLog) appendLog(code === 0 ? "작업 완료" : `작업 실패 code=${code}`);
      resolve({ ok: code === 0, code, output });
    });
    child.on("error", (error) => {
      if (shouldLog) appendLog(`작업 실패: ${error.message}`);
      resolve({ ok: false, code: -1, output: error.message });
    });
  });
}

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.max(1280, Math.min(2048, workArea.width - 24));
  const height = Math.max(620, Math.min(720, workArea.height - 48));
  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 1240,
    minHeight: 620,
    title: "Economy News Dashboard Control",
    backgroundColor: "#f3f3f3",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(controlRoot, "preload.js")
    }
  });
  mainWindow.loadFile(path.join(controlRoot, "index.html"));
  mainWindow.on("close", (event) => {
    if (allowClose) return;
    event.preventDefault();
    allowClose = true;
    appendLog("컨트롤 창 종료 요청: 실행 중인 서비스를 중지합니다.");
    control(["stop"]).finally(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
      app.quit();
    });
  });
}

function createLogWindow() {
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.focus();
    logWindow.webContents.send("log-update", logLines);
    return;
  }
  logWindow = new BrowserWindow({
    width: 900,
    height: 560,
    minWidth: 760,
    minHeight: 420,
    title: "Economy News Logs",
    backgroundColor: "#111827",
    autoHideMenuBar: true,
    parent: mainWindow || undefined,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(controlRoot, "preload.js")
    }
  });
  logWindow.loadFile(path.join(controlRoot, "log.html"));
  logWindow.webContents.once("did-finish-load", () => {
    logWindow.webContents.send("log-update", logLines);
  });
  logWindow.on("closed", () => {
    logWindow = null;
  });
}

ipcMain.handle("initial-state", async () => {
  const status = await control(["status"], { log: false });
  return { installPath: readInstallPath(), status: status.output };
});

ipcMain.handle("choose-path", async () => {
  const result = await dialog.showOpenDialog({
    title: "설치할 폴더 선택",
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return normalizeInstallPath(result.filePaths[0]);
});

ipcMain.handle("run-control", async (_event, action, installPath) => {
  const args = action === "install" ? ["install", installPath || defaultInstallPath] : [action];
  return control(args);
});

ipcMain.handle("open-log", async () => {
  createLogWindow();
  const logPath = controlLogPath();
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, "", "utf8");
  return logPath;
});

ipcMain.handle("log-lines", async () => logLines);

ipcMain.handle("open-url", async () => {
  await shell.openExternal("http://127.0.0.1:8000");
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  app.quit();
});
