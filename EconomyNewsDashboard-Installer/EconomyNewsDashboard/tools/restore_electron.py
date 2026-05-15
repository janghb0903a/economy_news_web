from pathlib import Path
import shutil


APP_ROOT = Path(__file__).resolve().parents[1]
PARTS_DIR = APP_ROOT / "control-ui" / "electron-bin"
ELECTRON_EXE = APP_ROOT / "control-ui" / "node_modules" / "electron" / "dist" / "electron.exe"


def main() -> int:
    parts = sorted(PARTS_DIR.glob("electron.exe.part*"))
    if not parts:
        return 0
    ELECTRON_EXE.parent.mkdir(parents=True, exist_ok=True)
    temp_path = ELECTRON_EXE.with_suffix(".exe.tmp")
    with temp_path.open("wb") as output:
        for part in parts:
            with part.open("rb") as source:
                shutil.copyfileobj(source, output, length=1024 * 1024)
    temp_path.replace(ELECTRON_EXE)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
