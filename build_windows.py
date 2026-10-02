"""AragonTask APK build, native Windows variant of build.sh (no WSL/gradle).

Same pipeline: aapt2 compile/link -> javac -> d8 -> package dex -> zipalign -> sign.
Uses ~/android-sdk (installed by setup_sdk_windows.py) and the system JDK.
"""
import os, shutil, subprocess, sys, zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(ROOT, "app")
SDK = os.path.join(os.path.expanduser("~"), "android-sdk")
BT = os.path.join(SDK, "build-tools", "34.0.0")
PLAT = os.path.join(SDK, "platforms", "android-34", "android.jar")

VER_CODE = "9"
VER_NAME = "1.7.0"
OUT_APK = os.path.join(ROOT, "AragonTask-v%s.apk" % VER_NAME)
KEYSTORE = os.path.join(ROOT, "terra.keystore")

def run(cmd, **kw):
    print("+", " ".join(os.path.basename(c) if os.sep in c else c for c in cmd), flush=True)
    r = subprocess.run(cmd, cwd=APP, capture_output=True, text=True, shell=False, **kw)
    if r.returncode != 0:
        print(r.stdout)
        print(r.stderr)
        sys.exit("FAILED: " + " ".join(cmd))
    if r.stdout and r.stdout.strip():
        print(r.stdout.strip()[:800])
    return r

shutil.rmtree(os.path.join(APP, "build"), ignore_errors=True)
os.makedirs(os.path.join(APP, "build", "gen"), exist_ok=True)
os.makedirs(os.path.join(APP, "build", "classes"), exist_ok=True)
b = lambda *p: os.path.join(APP, "build", *p)

print("[1/7] aapt2 compile")
run([os.path.join(BT, "aapt2.exe"), "compile", "--dir", "res", "-o", "build/res.zip"])

print("[2/7] aapt2 link")
run([os.path.join(BT, "aapt2.exe"), "link", "-o", "build/base.apk", "-I", PLAT,
     "--manifest", "AndroidManifest.xml",
     "--min-sdk-version", "24", "--target-sdk-version", "34",
     "--version-code", VER_CODE, "--version-name", VER_NAME,
     "-A", "assets", "--java", "build/gen", "build/res.zip"])

print("[3/7] javac")
srcs = []
for base, _, files in os.walk(os.path.join(APP, "build", "gen")):
    srcs += [os.path.join(base, f) for f in files if f.endswith(".java")]
for base, _, files in os.walk(os.path.join(APP, "src")):
    srcs += [os.path.join(base, f) for f in files if f.endswith(".java")]
lst = b("srcs.txt")
with open(lst, "w", encoding="utf-8") as f:
    f.write("\n".join(srcs))
run(["javac", "-encoding", "UTF-8", "-classpath", PLAT, "-d", "build/classes", "@" + "build/srcs.txt"])

print("[4/7] d8 dex")
classes = []
for base, _, files in os.walk(os.path.join(APP, "build", "classes")):
    classes += [os.path.join(base, f) for f in files if f.endswith(".class")]
run(["cmd", "/c", os.path.join(BT, "d8.bat"), "--release", "--min-api", "24",
     "--lib", PLAT, "--output", "build"] + classes)

print("[5/7] package dex into apk")
z = zipfile.ZipFile(b("base.apk"), "a", zipfile.ZIP_DEFLATED)
z.write(b("classes.dex"), "classes.dex")
z.close()
print("  classes.dex appended")

print("[6/7] zipalign")
run([os.path.join(BT, "zipalign.exe"), "-f", "4", "build/base.apk", "build/aligned.apk"])

print("[7/7] sign")
if not os.path.exists(KEYSTORE):
    run(["keytool", "-genkeypair", "-keystore", KEYSTORE, "-alias", "terra",
         "-keyalg", "RSA", "-keysize", "2048", "-validity", "10950",
         "-storepass", "terra2024", "-keypass", "terra2024",
         "-dname", "CN=Terra, O=Terra Labs, C=CN"])
    print("  keystore created")
run(["cmd", "/c", os.path.join(BT, "apksigner.bat"), "sign",
     "--ks", KEYSTORE, "--ks-pass", "pass:terra2024", "--key-pass", "pass:terra2024",
     "--out", OUT_APK, "build/aligned.apk"])
r = run(["cmd", "/c", os.path.join(BT, "apksigner.bat"), "verify", "--print-certs", OUT_APK])
print(r.stdout[:400])
print("BUILD_OK ->", OUT_APK)
