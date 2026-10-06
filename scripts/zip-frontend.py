import os, zipfile

ROOT = r"C:\Users\Lenovo\WorkBuddy\2026-09-29-21-33-32\four-seasons-journey-main"
TOP = "guayouji-miniprogram-deploy-20261003"   # 解压后顶层文件夹名
OUT = os.path.join(ROOT, "guayouji-miniprogram-deploy-20261003.zip")

include = [
    ("project.config.json", os.path.join(ROOT, "project.config.json")),
    ("project.private.config.json", os.path.join(ROOT, "project.private.config.json")),
]
# miniprogram/ 整目录递归
mini = os.path.join(ROOT, "miniprogram")
for dirpath, dirnames, filenames in os.walk(mini):
    # 跳过任何意外出现的 node_modules / .git
    dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".git", "__pycache__")]
    for fn in filenames:
        full = os.path.join(dirpath, fn)
        rel = os.path.relpath(full, ROOT)
        include.append((rel, full))

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for arcname, full in include:
        # 统一用 TOP/ 作为前缀，解压即得到一个干净工程目录
        z.write(full, os.path.join(TOP, arcname).replace("\\", "/"))

print("WROTE", OUT)
print("ENTRIES", len(include))
