"""Fetch Android SDK pieces for a native Windows build (no WSL needed).

Downloads (into ~/android-sdk):
  - platforms/android-34   from platform-34_r02.zip   (cross-platform jar/manifest resources)
  - build-tools/34.0.0     from build-tools_r34-windows.zip (aapt2.exe, d8.bat, zipalign.exe, apksigner.bat)
"""
import os, shutil, sys, tempfile, urllib.request, zipfile

BASE = os.path.join(os.path.expanduser("~"), "android-sdk")
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/120"}

def fetch(url, dest):
    print("download:", url, flush=True)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=300) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)
    print("  ->", dest, os.path.getsize(dest) // 1024, "KB", flush=True)

def install(url, dest):
    marker = dest + os.sep + ".ok"
    if os.path.exists(marker):
        print("already installed:", dest)
        return
    z = os.path.join(tempfile.gettempdir(), os.path.basename(url))
    fetch(url, z)
    tmp = tempfile.mkdtemp(prefix="sdk_")
    with zipfile.ZipFile(z) as zf:
        zf.extractall(tmp)
    roots = os.listdir(tmp)
    src = os.path.join(tmp, roots[0]) if len(roots) == 1 else tmp
    shutil.rmtree(dest, ignore_errors=True)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.move(src, dest)
    open(marker, "w").write("ok")
    print("installed ->", dest, flush=True)

if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    if which in ("all", "platform"):
        install("https://dl.google.com/android/repository/platform-34-ext7_r03.zip",
                os.path.join(BASE, "platforms", "android-34"))
    if which in ("all", "buildtools"):
        install("https://dl.google.com/android/repository/build-tools_r34-windows.zip",
                os.path.join(BASE, "build-tools", "34.0.0"))
    print("SDK_WINDOWS_OK")
