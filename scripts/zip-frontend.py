import os, sys, zipfile

ROOT = r"C:\Users\Lenovo\WorkBuddy\2026-09-29-21-33-32\four-seasons-journey-main"
# 版本号必须递增、绝不复用（项目铁律）：传入参数形如 20261006-v4。
VERSION = sys.argv[1] if len(sys.argv) > 1 else "20261006-v4"
TOP = "guayouji-miniprogram-deploy-" + VERSION   # 解压后顶层文件夹名
OUT = os.path.join(ROOT, TOP + ".zip")

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
