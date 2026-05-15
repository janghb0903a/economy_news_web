import ctypes
import ctypes.wintypes
import json
import os
import subprocess
import shutil
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path


SOURCE_APP_ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = SOURCE_APP_ROOT
PACKAGE_ROOT = APP_ROOT.parent
BACKEND_DIR = APP_ROOT / "backend"
PYTHON = APP_ROOT / "runtime" / "python" / "python.exe"
PYTHONW = APP_ROOT / "runtime" / "python" / "pythonw.exe"
STATE_DIR = APP_ROOT / ".runtime"
STATE_FILE = STATE_DIR / "service.json"
LOG_DIR = APP_ROOT / "logs"
INSTALL_STATE_FILE = SOURCE_APP_ROOT / ".runtime" / "install-target.json"
DEFAULT_INSTALL_ROOT = Path(os.environ.get("SystemDrive", "C:") + "\\EconomyNewsDashboard")
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000
DEFAULT_AI_PROVIDER = "gemini"
DEFAULT_AI_MODEL = "gemini-2.5-flash-lite"
CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def rgb(red, green, blue):
    return red | (green << 8) | (blue << 16)


def set_app_root(path):
    global APP_ROOT, PACKAGE_ROOT, BACKEND_DIR, PYTHON, PYTHONW, STATE_DIR, STATE_FILE, LOG_DIR
    APP_ROOT = Path(path)
    PACKAGE_ROOT = APP_ROOT.parent
    BACKEND_DIR = APP_ROOT / "backend"
    PYTHON = APP_ROOT / "runtime" / "python" / "python.exe"
    PYTHONW = APP_ROOT / "runtime" / "python" / "pythonw.exe"
    STATE_DIR = APP_ROOT / ".runtime"
    STATE_FILE = STATE_DIR / "service.json"
    LOG_DIR = APP_ROOT / "logs"


def load_install_target():
    if not INSTALL_STATE_FILE.exists():
        return None
    try:
        value = json.loads(INSTALL_STATE_FILE.read_text(encoding="utf-8")).get("install_path")
    except (json.JSONDecodeError, OSError):
        return None
    if not value:
        return None
    return Path(value)


def save_install_target(path):
    INSTALL_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    INSTALL_STATE_FILE.write_text(json.dumps({"install_path": str(Path(path))}, indent=2), encoding="utf-8")


def control_log_dir():
    return LOG_DIR if APP_ROOT.exists() else SOURCE_APP_ROOT / "logs"


class DRAWITEMSTRUCT(ctypes.Structure):
    _fields_ = [
        ("CtlType", ctypes.c_uint),
        ("CtlID", ctypes.c_uint),
        ("itemID", ctypes.c_uint),
        ("itemAction", ctypes.c_uint),
        ("itemState", ctypes.c_uint),
        ("hwndItem", ctypes.wintypes.HWND),
        ("hDC", ctypes.wintypes.HDC),
        ("rcItem", ctypes.wintypes.RECT),
        ("itemData", ctypes.c_size_t),
    ]


class BROWSEINFO(ctypes.Structure):
    _fields_ = [
        ("hwndOwner", ctypes.wintypes.HWND),
        ("pidlRoot", ctypes.c_void_p),
        ("pszDisplayName", ctypes.wintypes.LPWSTR),
        ("lpszTitle", ctypes.wintypes.LPCWSTR),
        ("ulFlags", ctypes.c_uint),
        ("lpfn", ctypes.c_void_p),
        ("lParam", ctypes.c_ssize_t),
        ("iImage", ctypes.c_int),
    ]


def read_env_value(key, default=""):
    env_file = APP_ROOT / ".env"
    if not env_file.exists():
        return default
    for raw_line in env_file.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        if name.strip() == key:
            return value.strip().strip('"').strip("'")
    return default


def app_port():
    try:
        return int(read_env_value("APP_PORT", str(DEFAULT_PORT)))
    except ValueError:
        return DEFAULT_PORT


def app_host():
    return read_env_value("APP_HOST", DEFAULT_HOST) or DEFAULT_HOST


def app_url():
    return f"http://{app_host()}:{app_port()}"


def process_env():
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    backend_path = str(BACKEND_DIR)
    env["PYTHONPATH"] = backend_path if not env.get("PYTHONPATH") else f"{backend_path}{os.pathsep}{env['PYTHONPATH']}"
    return env


def load_state():
    if not STATE_FILE.exists():
        return {}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def save_state(pid):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps({"pid": pid, "url": app_url(), "updated_at": time.time()}, indent=2), encoding="utf-8")


def clear_state():
    if STATE_FILE.exists():
        STATE_FILE.unlink()


def tasklist_contains(pid):
    if not pid:
        return False
    result = subprocess.run(
        ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
        capture_output=True,
        text=True,
        creationflags=CREATE_NO_WINDOW,
    )
    return str(pid) in result.stdout


def current_pid():
    pid = load_state().get("pid")
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return None
    return pid if tasklist_contains(pid) else None


def ensure_database():
    if not BACKEND_DIR.exists():
        raise FileNotFoundError("설치 경로에 앱 파일이 없습니다. 먼저 설치 / 초기화를 실행하세요.")
    APP_ROOT.joinpath("data").mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(BACKEND_DIR))
    old_cwd = Path.cwd()
    os.chdir(APP_ROOT)
    try:
        from app.db.init_db import init_db
        from app.db.session import SessionLocal

        db = SessionLocal()
        try:
            init_db(db)
        finally:
            db.close()
    finally:
        os.chdir(old_cwd)


def ensure_env_defaults():
    env_path = APP_ROOT / ".env"
    if not env_path.exists():
        example_path = APP_ROOT / ".env.example"
        if example_path.exists():
            shutil.copy2(example_path, env_path)
        else:
            env_path.write_text("", encoding="utf-8")
    desired = {
        "AI_PROVIDER": DEFAULT_AI_PROVIDER,
        "AI_MODEL": DEFAULT_AI_MODEL,
        "GEMINI_MODEL": DEFAULT_AI_MODEL,
    }
    lines = env_path.read_text(encoding="utf-8").splitlines()
    seen = set()
    next_lines = []
    for line in lines:
        key = line.split("=", 1)[0] if "=" in line else ""
        if key in desired:
            next_lines.append(f"{key}={desired[key]}")
            seen.add(key)
        else:
            next_lines.append(line)
    for key, value in desired.items():
        if key not in seen:
            next_lines.append(f"{key}={value}")
    env_path.write_text("\n".join(next_lines) + "\n", encoding="utf-8")


def apply_install_default_settings():
    sys.path.insert(0, str(BACKEND_DIR))
    old_cwd = Path.cwd()
    os.chdir(APP_ROOT)
    try:
        from app.db.session import SessionLocal
        from app.models.entities import AppSetting

        db = SessionLocal()
        try:
            desired = {
                "ai_provider": DEFAULT_AI_PROVIDER,
                "ai_model": DEFAULT_AI_MODEL,
                "enable_ai_summary_postprocess": "True",
                "enable_title_translation_postprocess": "False",
            }
            for key, value in desired.items():
                setting = db.get(AppSetting, key) or AppSetting(key=key)
                setting.value = value
                db.add(setting)
            db.commit()
        finally:
            db.close()
    finally:
        os.chdir(old_cwd)


def wait_for_health(seconds=25):
    health_url = f"{app_url()}/health"
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(health_url, timeout=1.5) as response:
                if response.status == 200:
                    return True
        except (OSError, urllib.error.URLError):
            time.sleep(0.7)
    return False


def start_service(open_browser=True):
    pid = current_pid()
    if pid:
        print(f"Already running. PID={pid}")
        if open_browser:
            webbrowser.open(app_url())
        return pid

    ensure_database()
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_file = open(LOG_DIR / "backend.log", "a", encoding="utf-8")
    cmd = [
        str(PYTHONW if PYTHONW.exists() else PYTHON),
        "-m",
        "uvicorn",
        "app.main:app",
        "--host",
        app_host(),
        "--port",
        str(app_port()),
    ]
    proc = subprocess.Popen(
        cmd,
        cwd=str(APP_ROOT),
        env=process_env(),
        stdout=log_file,
        stderr=subprocess.STDOUT,
        creationflags=CREATE_NO_WINDOW,
    )
    save_state(proc.pid)
    print(f"Starting Economy News Dashboard. PID={proc.pid}")
    if wait_for_health():
        print(f"Dashboard is ready: {app_url()}")
        if open_browser:
            webbrowser.open(app_url())
    else:
        print("Started, but health check did not respond yet. Check EconomyNewsDashboard\\logs\\backend.log")
    return proc.pid


def stop_service():
    pid = current_pid()
    if not pid:
        clear_state()
        print("Service is not running.")
        return
    subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], creationflags=CREATE_NO_WINDOW)
    clear_state()
    print("Service stopped.")


def status():
    pid = current_pid()
    if pid:
        print(f"Running. PID={pid}")
        print(app_url())
    else:
        print("Stopped.")


def control_cmd_text():
    return (
        "@echo off\r\n"
        "setlocal\r\n"
        'cd /d "%~dp0"\r\n'
        "set ELECTRON_RUN_AS_NODE=\r\n"
        'set "APPDIR=%~dp0"\r\n'
        'set "ELECTRON=%APPDIR%control-ui\\node_modules\\electron\\dist\\electron.exe"\r\n'
        'if not exist "%ELECTRON%" if exist "%APPDIR%control-ui\\electron-bin\\electron.exe.part001" (\r\n'
        '  "%APPDIR%runtime\\python\\python.exe" "%APPDIR%tools\\restore_electron.py"\r\n'
        ")\r\n"
        'if exist "%ELECTRON%" (\r\n'
        '  start "" "%ELECTRON%" "%APPDIR%control-ui"\r\n'
        ") else (\r\n"
        '  set "PYTHON=%APPDIR%runtime\\python\\pythonw.exe"\r\n'
        '  if not exist "%PYTHON%" set "PYTHON=%APPDIR%runtime\\python\\python.exe"\r\n'
        '  start "" "%PYTHON%" "%APPDIR%tools\\control.py" gui\r\n'
        ")\r\n"
        "endlocal\r\n"
    )


def create_local_control_file():
    target = APP_ROOT / "control.cmd"
    target.write_text(control_cmd_text(), encoding="utf-8")
    print(f"Local control file created: {target}")


def create_desktop_control_file():
    create_local_control_file()
    desktop = Path(os.environ.get("USERPROFILE", "")) / "Desktop"
    if not desktop.exists():
        return
    target = desktop / "Economy News Dashboard Control.cmd"
    target.write_text(
        f'@echo off\r\nstart "" "{APP_ROOT / "control.cmd"}"\r\n',
        encoding="utf-8",
    )
    print(f"Desktop control file created: {target}")


def should_skip_copy(path):
    parts = {part.lower() for part in path.parts}
    if "__pycache__" in parts:
        return True
    return path.name.lower() in {".runtime", "logs"}


def copy_package_to(target_root):
    source_root = SOURCE_APP_ROOT.resolve()
    target_root = Path(target_root).resolve()
    if source_root == target_root:
        return
    target_root.mkdir(parents=True, exist_ok=True)
    for item in SOURCE_APP_ROOT.iterdir():
        if should_skip_copy(item):
            continue
        target_item = target_root / item.name
        if item.name == "data":
            target_item.mkdir(exist_ok=True)
            continue
        if item.name == ".env" and target_item.exists():
            continue
        if item.is_dir():
            shutil.copytree(
                item,
                target_item,
                dirs_exist_ok=True,
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo", ".runtime", "logs"),
            )
        else:
            shutil.copy2(item, target_item)


def install(target_root=None):
    target_root = Path(target_root or APP_ROOT)
    print(f"Installing Economy News Dashboard to {target_root}...")
    copy_package_to(target_root)
    set_app_root(target_root)
    save_install_target(target_root)
    ensure_env_defaults()
    ensure_database()
    apply_install_default_settings()
    create_desktop_control_file()
    print("Install is ready. Use Start to launch the dashboard.")


def open_log_file():
    log_dir = control_log_dir()
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "control.log"
    log_path.touch(exist_ok=True)
    subprocess.Popen(["notepad.exe", str(log_path)], creationflags=CREATE_NO_WINDOW)


class NativeControlWindow:
    WM_DESTROY = 0x0002
    WM_COMMAND = 0x0111
    WM_TIMER = 0x0113
    WM_SETFONT = 0x0030
    WM_CTLCOLORSTATIC = 0x0138
    WM_CTLCOLOREDIT = 0x0133
    WM_PAINT = 0x000F
    WM_DRAWITEM = 0x002B

    WS_OVERLAPPEDWINDOW = 0x00CF0000
    WS_VISIBLE = 0x10000000
    WS_CHILD = 0x40000000
    WS_TABSTOP = 0x00010000
    WS_VSCROLL = 0x00200000
    ES_MULTILINE = 0x0004
    ES_AUTOHSCROLL = 0x0080
    ES_AUTOVSCROLL = 0x0040
    ES_READONLY = 0x0800
    BS_OWNERDRAW = 0x0000000B
    SS_LEFT = 0x00000000
    SS_CENTER = 0x00000001
    SS_CENTERIMAGE = 0x00000200
    WS_EX_CLIENTEDGE = 0x00000200

    SW_SHOW = 5
    TRANSPARENT = 1
    FW_NORMAL = 400
    FW_SEMIBOLD = 600
    FW_BOLD = 700
    PS_SOLID = 0
    DT_CENTER = 0x00000001
    DT_LEFT = 0x00000000
    DT_VCENTER = 0x00000004
    DT_SINGLELINE = 0x00000020
    DT_WORDBREAK = 0x00000010
    DT_END_ELLIPSIS = 0x00008000
    ODS_SELECTED = 0x0001

    ID_INSTALL = 1001
    ID_START = 1002
    ID_STOP = 1003
    ID_RESTART = 1004
    ID_OPEN = 1005
    ID_LOGS = 1006
    ID_EXIT = 1007
    ID_BROWSE = 1008
    TIMER_ID = 1

    def __init__(self):
        self.user32 = ctypes.windll.user32
        self.gdi32 = ctypes.windll.gdi32
        self.kernel32 = ctypes.windll.kernel32
        self.hinst = self.kernel32.GetModuleHandleW(None)
        self.configure_winapi()
        self.bg_color = rgb(243, 244, 246)
        self.panel_color = rgb(255, 255, 255)
        self.panel_border = rgb(221, 225, 230)
        self.text_color = rgb(24, 28, 33)
        self.muted_color = rgb(92, 99, 112)
        self.blue = rgb(0, 103, 192)
        self.blue_dark = rgb(0, 82, 153)
        self.green = rgb(16, 124, 16)
        self.gray = rgb(232, 234, 237)
        self.bg_brush = self.gdi32.CreateSolidBrush(self.bg_color)
        self.panel_brush = self.gdi32.CreateSolidBrush(self.panel_color)
        self.log_brush = self.gdi32.CreateSolidBrush(rgb(255, 255, 255))
        self.font = self.create_font(14, self.FW_NORMAL)
        self.title_font = self.create_font(25, self.FW_SEMIBOLD, "Segoe UI Variable Display")
        self.subtitle_font = self.create_font(16, self.FW_SEMIBOLD)
        self.small_font = self.create_font(12, self.FW_NORMAL)
        self.caption_font = self.create_font(11, self.FW_NORMAL)
        self.card_title_font = self.create_font(16, self.FW_SEMIBOLD)
        self.button_font = self.create_font(13, self.FW_SEMIBOLD)
        self.hwnd = None
        self.controls = {}
        self.static_styles = {}
        self.button_styles = {}
        self.log_lines = []
        self.lock = threading.Lock()
        self.busy = False
        self.last_pid = None
        self.install_path = load_install_target() or DEFAULT_INSTALL_ROOT
        set_app_root(self.install_path if self.install_path.exists() else self.install_path)
        self._wndproc_ref = None

    def configure_winapi(self):
        wintypes = ctypes.wintypes
        self.kernel32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
        self.kernel32.GetModuleHandleW.restype = wintypes.HMODULE
        self.user32.CreateWindowExW.argtypes = [
            wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
            ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
            wintypes.HWND, wintypes.HMENU, wintypes.HINSTANCE, wintypes.LPVOID,
        ]
        self.user32.CreateWindowExW.restype = wintypes.HWND
        self.user32.DefWindowProcW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        self.user32.DefWindowProcW.restype = ctypes.c_ssize_t
        self.user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        self.user32.SendMessageW.restype = ctypes.c_ssize_t
        self.user32.SetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPCWSTR]
        self.user32.SetWindowTextW.restype = wintypes.BOOL
        self.user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
        self.user32.GetWindowTextLengthW.restype = ctypes.c_int
        self.user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
        self.user32.GetWindowTextW.restype = ctypes.c_int
        self.user32.DestroyWindow.argtypes = [wintypes.HWND]
        self.user32.DestroyWindow.restype = wintypes.BOOL
        self.user32.SetTimer.argtypes = [wintypes.HWND, ctypes.c_size_t, wintypes.UINT, wintypes.LPVOID]
        self.user32.SetTimer.restype = ctypes.c_size_t
        self.user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
        self.user32.ShowWindow.restype = wintypes.BOOL
        self.user32.UpdateWindow.argtypes = [wintypes.HWND]
        self.user32.UpdateWindow.restype = wintypes.BOOL
        self.user32.InvalidateRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT), wintypes.BOOL]
        self.user32.InvalidateRect.restype = wintypes.BOOL
        self.user32.FillRect.argtypes = [wintypes.HDC, ctypes.POINTER(wintypes.RECT), wintypes.HBRUSH]
        self.user32.FillRect.restype = ctypes.c_int
        self.user32.BeginPaint.argtypes = [wintypes.HWND, ctypes.c_void_p]
        self.user32.BeginPaint.restype = wintypes.HDC
        self.user32.EndPaint.argtypes = [wintypes.HWND, ctypes.c_void_p]
        self.user32.EndPaint.restype = wintypes.BOOL
        self.user32.GetMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT]
        self.user32.GetMessageW.restype = wintypes.BOOL
        self.user32.TranslateMessage.argtypes = [ctypes.POINTER(wintypes.MSG)]
        self.user32.TranslateMessage.restype = wintypes.BOOL
        self.user32.DispatchMessageW.argtypes = [ctypes.POINTER(wintypes.MSG)]
        self.user32.DispatchMessageW.restype = ctypes.c_ssize_t
        self.user32.PostQuitMessage.argtypes = [ctypes.c_int]
        self.user32.PostQuitMessage.restype = None
        self.user32.LoadCursorW.argtypes = [wintypes.HINSTANCE, ctypes.c_void_p]
        self.user32.LoadCursorW.restype = ctypes.c_void_p
        self.user32.DrawTextW.argtypes = [wintypes.HDC, wintypes.LPCWSTR, ctypes.c_int, ctypes.POINTER(wintypes.RECT), wintypes.UINT]
        self.user32.DrawTextW.restype = ctypes.c_int
        self.gdi32.CreateFontW.argtypes = [
            ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
            wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD,
            wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD,
            wintypes.LPCWSTR,
        ]
        self.gdi32.CreateFontW.restype = wintypes.HFONT
        self.gdi32.CreateSolidBrush.argtypes = [wintypes.COLORREF]
        self.gdi32.CreateSolidBrush.restype = wintypes.HBRUSH
        self.gdi32.CreatePen.argtypes = [ctypes.c_int, ctypes.c_int, wintypes.COLORREF]
        self.gdi32.CreatePen.restype = wintypes.HPEN
        self.gdi32.SelectObject.argtypes = [wintypes.HDC, wintypes.HGDIOBJ]
        self.gdi32.SelectObject.restype = wintypes.HGDIOBJ
        self.gdi32.DeleteObject.argtypes = [wintypes.HGDIOBJ]
        self.gdi32.DeleteObject.restype = wintypes.BOOL
        self.gdi32.RoundRect.argtypes = [wintypes.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int]
        self.gdi32.RoundRect.restype = wintypes.BOOL
        self.gdi32.Ellipse.argtypes = [wintypes.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int]
        self.gdi32.Ellipse.restype = wintypes.BOOL
        self.gdi32.SetTextColor.argtypes = [wintypes.HDC, wintypes.COLORREF]
        self.gdi32.SetTextColor.restype = wintypes.COLORREF
        self.gdi32.SetBkMode.argtypes = [wintypes.HDC, ctypes.c_int]
        self.gdi32.SetBkMode.restype = ctypes.c_int
        ctypes.windll.shell32.SHBrowseForFolderW.argtypes = [ctypes.POINTER(BROWSEINFO)]
        ctypes.windll.shell32.SHBrowseForFolderW.restype = ctypes.c_void_p
        ctypes.windll.shell32.SHGetPathFromIDListW.argtypes = [ctypes.c_void_p, wintypes.LPWSTR]
        ctypes.windll.shell32.SHGetPathFromIDListW.restype = wintypes.BOOL
        ctypes.windll.ole32.CoTaskMemFree.argtypes = [ctypes.c_void_p]
        ctypes.windll.ole32.CoTaskMemFree.restype = None

    def create_font(self, point_size, weight, face="Segoe UI Variable Text"):
        height = -int(point_size * 96 / 72)
        return self.gdi32.CreateFontW(height, 0, 0, 0, weight, 0, 0, 0, 1, 0, 0, 5, 0, face)

    def log(self, message, persist=True):
        stamp = time.strftime("%H:%M:%S")
        line = f"[{stamp}] {message}"
        with self.lock:
            self.log_lines.append(line)
            self.log_lines = self.log_lines[-120:]
        if not persist:
            return
        try:
            log_dir = control_log_dir()
            log_dir.mkdir(parents=True, exist_ok=True)
            with open(log_dir / "control.log", "a", encoding="utf-8") as file:
                file.write(line + "\n")
        except OSError:
            pass

    def run_action(self, label, func):
        if self.busy:
            self.log("작업이 진행 중입니다.")
            return

        def worker():
            self.busy = True
            self.log(f"{label} 시작")
            try:
                func()
                self.log(f"{label} 완료")
            except Exception as exc:
                self.log(f"{label} 실패: {exc}")
            finally:
                self.busy = False

        threading.Thread(target=worker, daemon=True).start()

    def create_control(self, class_name, text, x, y, w, h, style=0, ex_style=0, control_id=0, font=None, text_color=None):
        hwnd = self.user32.CreateWindowExW(
            ex_style,
            class_name,
            text,
            self.WS_CHILD | self.WS_VISIBLE | style,
            x,
            y,
            w,
            h,
            self.hwnd,
            ctypes.c_void_p(control_id),
            self.hinst,
            None,
        )
        self.user32.SendMessageW(hwnd, self.WM_SETFONT, font or self.font, True)
        if control_id:
            self.controls[control_id] = hwnd
        if class_name == "STATIC":
            self.static_styles[hwnd] = text_color if text_color is not None else self.text_color
        return hwnd

    def create_button(self, text, x, y, w, h, control_id, tone="blue"):
        hwnd = self.create_control("BUTTON", text, x, y, w, h, self.BS_OWNERDRAW | self.WS_TABSTOP, 0, control_id, self.button_font)
        tones = {
            "blue": {"bg": self.blue, "fg": rgb(255, 255, 255), "border": self.blue, "pressed": self.blue_dark},
            "green": {"bg": self.green, "fg": rgb(255, 255, 255), "border": rgb(44, 190, 91), "pressed": rgb(8, 119, 49)},
            "gray": {"bg": self.gray, "fg": rgb(31, 35, 40), "border": rgb(209, 213, 219), "pressed": rgb(218, 221, 225)},
            "outline": {"bg": rgb(255, 255, 255), "fg": self.blue, "border": rgb(173, 200, 232), "pressed": rgb(235, 244, 255)},
            "danger": {"bg": rgb(255, 255, 255), "fg": rgb(170, 38, 38), "border": rgb(238, 185, 185), "pressed": rgb(255, 237, 237)},
        }
        self.button_styles[control_id] = {"text": text, **tones.get(tone, tones["blue"])}
        return hwnd

    def set_text(self, hwnd, text):
        self.user32.SetWindowTextW(hwnd, text)

    def get_text(self, hwnd):
        length = self.user32.GetWindowTextLengthW(hwnd)
        buffer = ctypes.create_unicode_buffer(length + 1)
        self.user32.GetWindowTextW(hwnd, buffer, length + 1)
        return buffer.value

    def selected_install_path(self):
        value = self.get_text(self.path_edit).strip() if getattr(self, "path_edit", None) else ""
        return Path(value or DEFAULT_INSTALL_ROOT)

    def use_selected_install_path(self):
        self.install_path = self.selected_install_path()
        set_app_root(self.install_path)
        return self.install_path

    def browse_install_path(self):
        display_name = ctypes.create_unicode_buffer(260)
        info = BROWSEINFO()
        info.hwndOwner = self.hwnd
        info.pszDisplayName = display_name
        info.lpszTitle = "설치할 폴더를 선택하세요"
        info.ulFlags = 0x00000001 | 0x00000040 | 0x00000010
        pidl = ctypes.windll.shell32.SHBrowseForFolderW(ctypes.byref(info))
        if not pidl:
            return
        try:
            path_buffer = ctypes.create_unicode_buffer(260)
            if ctypes.windll.shell32.SHGetPathFromIDListW(pidl, path_buffer):
                selected = Path(path_buffer.value)
                if selected.name.lower() != "economynewsdashboard":
                    selected = selected / "EconomyNewsDashboard"
                self.set_text(self.path_edit, str(selected))
                self.use_selected_install_path()
                self.refresh()
        finally:
            ctypes.windll.ole32.CoTaskMemFree(pidl)

    def create_ui(self):
        self.path_edit = self.create_control("EDIT", str(self.install_path), 54, 238, 560, 32, self.ES_AUTOHSCROLL, self.WS_EX_CLIENTEDGE, font=self.font)
        self.create_button("변경", 626, 237, 112, 34, self.ID_BROWSE, "gray")
        self.create_button("설치 / 초기화", 54, 414, 170, 40, self.ID_INSTALL, "blue")
        self.create_button("시작", 236, 414, 110, 40, self.ID_START, "green")
        self.create_button("중지", 358, 414, 110, 40, self.ID_STOP, "gray")
        self.create_button("접속", 480, 414, 110, 40, self.ID_OPEN, "outline")
        self.create_button("로그 보기", 602, 414, 136, 40, self.ID_LOGS, "gray")
        self.create_button("종료", 602, 520, 136, 38, self.ID_EXIT, "danger")
        self.log("준비됨", persist=False)
        self.refresh()

    def refresh(self):
        self.use_selected_install_path()
        pid = current_pid()
        self.last_pid = pid
        if self.hwnd:
            self.user32.InvalidateRect(self.hwnd, None, False)

    def command(self, control_id):
        if control_id == self.ID_INSTALL:
            target = self.use_selected_install_path()
            self.run_action("설치 / 초기화", lambda: install(target))
        elif control_id == self.ID_START:
            target = self.use_selected_install_path()
            self.run_action("서비스 시작", lambda: (set_app_root(target), start_service(open_browser=False)))
        elif control_id == self.ID_STOP:
            target = self.use_selected_install_path()
            self.run_action("서비스 중지", lambda: (set_app_root(target), stop_service()))
        elif control_id == self.ID_RESTART:
            target = self.use_selected_install_path()
            self.run_action("서비스 재시작", lambda: (set_app_root(target), stop_service(), start_service(open_browser=False)))
        elif control_id == self.ID_OPEN:
            target = self.use_selected_install_path()
            self.run_action("접속", lambda: (set_app_root(target), start_service(open_browser=False) if not current_pid() else None, webbrowser.open(app_url())))
        elif control_id == self.ID_LOGS:
            self.use_selected_install_path()
            open_log_file()
        elif control_id == self.ID_EXIT:
            self.user32.DestroyWindow(self.hwnd)
        elif control_id == self.ID_BROWSE:
            self.browse_install_path()

    def draw_round_rect(self, hdc, x, y, w, h, fill, border, radius=28):
        brush = self.gdi32.CreateSolidBrush(fill)
        pen = self.gdi32.CreatePen(self.PS_SOLID, 1, border)
        old_brush = self.gdi32.SelectObject(hdc, brush)
        old_pen = self.gdi32.SelectObject(hdc, pen)
        self.gdi32.RoundRect(hdc, x, y, x + w, y + h, radius, radius)
        self.gdi32.SelectObject(hdc, old_brush)
        self.gdi32.SelectObject(hdc, old_pen)
        self.gdi32.DeleteObject(brush)
        self.gdi32.DeleteObject(pen)

    def draw_circle(self, hdc, x, y, size, fill):
        brush = self.gdi32.CreateSolidBrush(fill)
        pen = self.gdi32.CreatePen(self.PS_SOLID, 1, fill)
        old_brush = self.gdi32.SelectObject(hdc, brush)
        old_pen = self.gdi32.SelectObject(hdc, pen)
        self.gdi32.Ellipse(hdc, x, y, x + size, y + size)
        self.gdi32.SelectObject(hdc, old_brush)
        self.gdi32.SelectObject(hdc, old_pen)
        self.gdi32.DeleteObject(brush)
        self.gdi32.DeleteObject(pen)

    def draw_text(self, hdc, text, x, y, w, h, font=None, color=None, flags=None):
        self.gdi32.SetBkMode(hdc, self.TRANSPARENT)
        self.gdi32.SetTextColor(hdc, color if color is not None else self.text_color)
        old_font = self.gdi32.SelectObject(hdc, font or self.font)
        rect = ctypes.wintypes.RECT(x, y, x + w, y + h)
        self.user32.DrawTextW(
            hdc,
            text,
            -1,
            ctypes.byref(rect),
            flags if flags is not None else self.DT_LEFT | self.DT_WORDBREAK,
        )
        self.gdi32.SelectObject(hdc, old_font)

    def draw_card(self, hdc, x, y, w, h, title, description, footer, icon_bg, icon_text):
        self.draw_round_rect(hdc, x, y, w, h, self.panel_color, self.panel_border, 22)
        self.draw_round_rect(hdc, x + 18, y + 18, 42, 42, icon_bg, icon_bg, 12)
        self.draw_text(hdc, icon_text, x + 18, y + 18, 42, 42, self.subtitle_font, rgb(255, 255, 255), self.DT_CENTER | self.DT_VCENTER | self.DT_SINGLELINE)
        self.draw_text(hdc, title, x + 72, y + 18, w - 94, 24, self.card_title_font, self.text_color, self.DT_LEFT | self.DT_SINGLELINE | self.DT_END_ELLIPSIS)
        self.draw_text(hdc, description, x + 72, y + 47, w - 94, 44, self.small_font, self.muted_color, self.DT_LEFT | self.DT_WORDBREAK)
        self.draw_text(hdc, footer, x + 18, y + h - 30, w - 36, 18, self.caption_font, rgb(104, 112, 123), self.DT_LEFT | self.DT_SINGLELINE | self.DT_END_ELLIPSIS)

    def draw_top_logo(self, hdc, x, y):
        self.draw_round_rect(hdc, x, y, 52, 52, self.blue, self.blue, 14)
        self.draw_round_rect(hdc, x + 13, y + 12, 26, 28, rgb(255, 255, 255), rgb(255, 255, 255), 4)
        self.draw_round_rect(hdc, x + 17, y + 17, 18, 4, rgb(0, 103, 192), rgb(0, 103, 192), 2)
        self.draw_round_rect(hdc, x + 17, y + 25, 18, 3, rgb(0, 103, 192), rgb(0, 103, 192), 2)
        self.draw_round_rect(hdc, x + 17, y + 32, 12, 3, rgb(0, 103, 192), rgb(0, 103, 192), 2)

    def paint_ui(self, hwnd):
        ps = ctypes.create_string_buffer(96)
        hdc = self.user32.BeginPaint(hwnd, ctypes.byref(ps))
        rect = ctypes.wintypes.RECT(0, 0, 790, 610)
        self.user32.FillRect(hdc, ctypes.byref(rect), self.bg_brush)

        self.draw_top_logo(hdc, 42, 34)
        self.draw_text(hdc, "Economy News Dashboard", 108, 34, 560, 44, self.title_font, self.text_color, self.DT_LEFT | self.DT_SINGLELINE | self.DT_VCENTER)
        self.draw_text(hdc, "오프라인 설치 및 로컬 서비스 제어", 110, 80, 560, 22, self.font, self.muted_color, self.DT_LEFT | self.DT_SINGLELINE)

        self.draw_round_rect(hdc, 36, 124, 724, 250, self.panel_color, self.panel_border, 18)
        self.draw_text(hdc, "설치 위치", 56, 150, 320, 24, self.card_title_font, self.text_color, self.DT_LEFT | self.DT_SINGLELINE)
        self.draw_text(
            hdc,
            "기본 경로는 C:\\EconomyNewsDashboard 입니다. 필요하면 변경 버튼으로 설치 위치를 바꿀 수 있습니다.",
            56,
            180,
            652,
            40,
            self.small_font,
            self.muted_color,
            self.DT_LEFT | self.DT_WORDBREAK,
        )

        status_text = f"실행 중  PID {self.last_pid}" if self.last_pid else "중지됨"
        status_bg = rgb(231, 247, 235) if self.last_pid else rgb(241, 243, 245)
        status_border = rgb(181, 225, 190) if self.last_pid else rgb(218, 222, 227)
        status_dot = self.green if self.last_pid else rgb(142, 148, 158)
        status_fg = rgb(18, 98, 35) if self.last_pid else rgb(89, 96, 106)

        self.draw_text(hdc, "서비스 상태", 56, 300, 120, 20, self.caption_font, self.muted_color, self.DT_LEFT | self.DT_SINGLELINE)
        self.draw_round_rect(hdc, 160, 292, 220, 38, status_bg, status_border, 10)
        self.draw_circle(hdc, 178, 306, 10, status_dot)
        self.draw_text(hdc, status_text, 198, 300, 156, 22, self.small_font, status_fg, self.DT_LEFT | self.DT_SINGLELINE | self.DT_VCENTER)
        self.draw_text(hdc, app_url(), 410, 300, 300, 22, self.small_font, self.blue, self.DT_LEFT | self.DT_SINGLELINE | self.DT_END_ELLIPSIS)

        self.draw_round_rect(hdc, 36, 398, 724, 84, self.panel_color, self.panel_border, 18)
        self.draw_text(hdc, "작업", 56, 422, 120, 22, self.card_title_font, self.text_color, self.DT_LEFT | self.DT_SINGLELINE)
        self.draw_text(hdc, "설치 후 시작을 누르면 백엔드 서비스가 숨김 실행됩니다. 접속 버튼은 브라우저에서 대시보드를 엽니다.", 56, 452, 500, 22, self.small_font, self.muted_color, self.DT_LEFT | self.DT_SINGLELINE | self.DT_END_ELLIPSIS)

        self.draw_round_rect(hdc, 36, 502, 724, 70, self.panel_color, self.panel_border, 18)
        self.draw_text(hdc, "로그는 화면에 계속 표시하지 않습니다. 로그 보기 버튼을 누르면 별도 창으로 확인할 수 있습니다.", 56, 526, 520, 22, self.small_font, self.muted_color, self.DT_LEFT | self.DT_SINGLELINE | self.DT_END_ELLIPSIS)
        self.user32.EndPaint(hwnd, ctypes.byref(ps))

    def draw_button(self, lparam):
        item = ctypes.cast(lparam, ctypes.POINTER(DRAWITEMSTRUCT)).contents
        spec = self.button_styles.get(item.CtlID)
        if not spec:
            return 0
        bg = spec["pressed"] if item.itemState & self.ODS_SELECTED else spec["bg"]
        rc = item.rcItem
        self.draw_round_rect(item.hDC, rc.left, rc.top, rc.right - rc.left, rc.bottom - rc.top, bg, spec["border"], 14)
        self.gdi32.SetBkMode(item.hDC, self.TRANSPARENT)
        self.gdi32.SetTextColor(item.hDC, spec["fg"])
        old_font = self.gdi32.SelectObject(item.hDC, self.button_font)
        text_rect = ctypes.wintypes.RECT(rc.left, rc.top, rc.right, rc.bottom)
        self.user32.DrawTextW(item.hDC, spec["text"], -1, ctypes.byref(text_rect), self.DT_CENTER | self.DT_VCENTER | self.DT_SINGLELINE)
        self.gdi32.SelectObject(item.hDC, old_font)
        return 1

    def wndproc(self, hwnd, msg, wparam, lparam):
        if msg == self.WM_PAINT:
            self.paint_ui(hwnd)
            return 0
        if msg == self.WM_DRAWITEM:
            return self.draw_button(lparam)
        if msg == self.WM_COMMAND:
            self.command(wparam & 0xFFFF)
            return 0
        if msg == self.WM_TIMER:
            self.refresh()
            return 0
        if msg == self.WM_CTLCOLORSTATIC:
            self.gdi32.SetBkMode(wparam, self.TRANSPARENT)
            color = self.static_styles.get(lparam, self.text_color)
            self.gdi32.SetTextColor(wparam, color)
            return self.bg_brush
        if msg == self.WM_CTLCOLOREDIT:
            self.gdi32.SetBkMode(wparam, self.TRANSPARENT)
            self.gdi32.SetTextColor(wparam, rgb(40, 46, 54))
            return self.log_brush
        if msg == self.WM_DESTROY:
            self.user32.PostQuitMessage(0)
            return 0
        return self.user32.DefWindowProcW(hwnd, msg, wparam, lparam)

    def show(self):
        WNDPROC = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, ctypes.c_void_p, ctypes.c_uint, ctypes.c_size_t, ctypes.c_ssize_t)

        class WNDCLASS(ctypes.Structure):
            _fields_ = [
                ("style", ctypes.c_uint),
                ("lpfnWndProc", WNDPROC),
                ("cbClsExtra", ctypes.c_int),
                ("cbWndExtra", ctypes.c_int),
                ("hInstance", ctypes.c_void_p),
                ("hIcon", ctypes.c_void_p),
                ("hCursor", ctypes.c_void_p),
                ("hbrBackground", ctypes.c_void_p),
                ("lpszMenuName", ctypes.c_wchar_p),
                ("lpszClassName", ctypes.c_wchar_p),
            ]

        self._wndproc_ref = WNDPROC(self.wndproc)
        class_name = "EconomyNewsDashboardWin11Control"
        wndclass = WNDCLASS()
        wndclass.lpfnWndProc = self._wndproc_ref
        wndclass.hInstance = self.hinst
        wndclass.hCursor = self.user32.LoadCursorW(None, ctypes.c_void_p(32512))
        wndclass.hbrBackground = self.bg_brush
        wndclass.lpszClassName = class_name
        self.user32.RegisterClassW(ctypes.byref(wndclass))

        self.hwnd = self.user32.CreateWindowExW(
            0,
            class_name,
            "Economy News Dashboard Setup",
            self.WS_OVERLAPPEDWINDOW | self.WS_VISIBLE,
            260,
            120,
            790,
            625,
            None,
            None,
            self.hinst,
            None,
        )
        self.create_ui()
        self.user32.SetTimer(self.hwnd, self.TIMER_ID, 1000, None)
        self.user32.ShowWindow(self.hwnd, self.SW_SHOW)
        self.user32.UpdateWindow(self.hwnd)

        msg = ctypes.wintypes.MSG()
        while self.user32.GetMessageW(ctypes.byref(msg), None, 0, 0) != 0:
            self.user32.TranslateMessage(ctypes.byref(msg))
            self.user32.DispatchMessageW(ctypes.byref(msg))


def run_gui():
    if os.name != "nt":
        menu()
        return
    NativeControlWindow().show()


def menu():
    while True:
        print()
        print("Economy News Dashboard Control")
        print("--------------------------------")
        status()
        print()
        print("1. Install / Initialize")
        print("2. Start")
        print("3. Stop")
        print("4. Open")
        print("5. Restart")
        print("6. Exit")
        choice = input("Select: ").strip()
        if choice == "1":
            install()
        elif choice == "2":
            start_service(open_browser=False)
        elif choice == "3":
            stop_service()
        elif choice == "4":
            if not current_pid():
                start_service(open_browser=False)
            webbrowser.open(app_url())
        elif choice == "5":
            stop_service()
            start_service(open_browser=False)
        elif choice == "6":
            return


def main():
    command = sys.argv[1].lower() if len(sys.argv) > 1 else "gui"
    if command in {"gui", "install-ui", "control"}:
        run_gui()
    elif command == "install":
        target = Path(sys.argv[2]) if len(sys.argv) > 2 else load_install_target() or DEFAULT_INSTALL_ROOT
        install(target)
    elif command == "start":
        set_app_root(load_install_target() or SOURCE_APP_ROOT)
        start_service(open_browser=True)
    elif command == "stop":
        set_app_root(load_install_target() or SOURCE_APP_ROOT)
        stop_service()
    elif command == "status":
        set_app_root(load_install_target() or SOURCE_APP_ROOT)
        status()
    elif command == "open":
        set_app_root(load_install_target() or SOURCE_APP_ROOT)
        if not current_pid():
            start_service(open_browser=False)
        webbrowser.open(app_url())
    else:
        menu()


if __name__ == "__main__":
    main()
