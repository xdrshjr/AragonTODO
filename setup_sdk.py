import re, os, shutil, sys, urllib.request, zipfile
BASE = os.path.expanduser("~/android-sdk")
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/120"}
def log(*a): print(*a, flush=True)
def fetch(url, dest):
    log("download:", url)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=300) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)
    log("  ->", dest, os.path.getsize(dest)//1024, "KB")

xml = urllib.request.urlopen(urllib.request.Request(
    "https://dl.google.com/android/repository/repository2-3.xml", headers=UA), timeout=60).read().decode()
def pkg_url(path_regex):
    for m in re.finditer(r'<remotePackage[^>]*path="([^"]+)"[^>]*>(.*?)</remotePackage>', xml, re.S):
        p, blk = m.group(1), m.group(2)
        if re.fullmatch(path_regex, p):
            u = re.search(r'<url>([^<]+)</url>', blk)
            if u: return "https://dl.google.com/android/repository/" + u.group(1)
    return None
plat = pkg_url(r"platforms;android-34(\.0\.0)?") or "https://dl.google.com/android/repository/platform-34_r02.zip"
bt = pkg_url(r"build-tools;34\.0\.0(\.0\.0)?") or "https://dl.google.com/android/repository/build-tools_r34-linux.zip"
log("platform url:", plat); log("buildtools url:", bt)

def install(url, dest):
    z = "/tmp/" + os.path.basename(url)
    fetch(url, z)
    tmp = "/tmp/un_" + os.path.basename(dest)
    shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
    with zipfile.ZipFile(z) as zf: zf.extractall(tmp)
    roots = os.listdir(tmp)
    src = os.path.join(tmp, roots[0]) if len(roots) == 1 else tmp
    shutil.rmtree(dest, ignore_errors=True); os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.move(src, dest)
    log("installed ->", dest)

install(plat, BASE + "/platforms/android-34")
install(bt, BASE + "/build-tools/34.0.0")
log("SDK_OK")

# fonts
os.makedirs("app/assets/fonts", exist_ok=True)
css_url = ("https://fonts.googleapis.com/css2?"
           "family=Inter:wght@400;500;600;700&"
           "family=Source+Serif+4:ital,wght@0,400;0,600&display=swap")
css = urllib.request.urlopen(urllib.request.Request(css_url, headers=UA), timeout=60).read().decode()
faces = re.findall(r"/\*\s*([\w-]+)\s*\*/\s*@font-face\s*\{(.*?)\}", css, re.S)
out = []
for subset, blk in faces:
    if subset != "latin": continue
    fam = re.search(r"font-family:\s*'([^']+)'", blk).group(1)
    style = re.search(r"font-style:\s*(\w+)", blk).group(1)
    wt = re.search(r"font-weight:\s*(\d+)", blk).group(1)
    u = re.search(r"url\((https://[^)]+\.woff2)\)", blk).group(1)
    name = fam.replace(" ", "") + "-" + wt + ("i" if style == "italic" else "") + ".woff2"
    fetch(u, "app/assets/fonts/" + name)
    out.append("/* %s */\n@font-face{font-family:'%s';font-style:%s;font-weight:%s;font-display:swap;src:url('%s') format('woff2');}"
               % (fam, fam, style, wt, name))
open("app/assets/fonts/fonts.css", "w").write("\n".join(out) + "\n")
log("FONTS_OK")
log("ALL_DONE")
