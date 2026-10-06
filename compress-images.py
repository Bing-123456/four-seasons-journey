import os
from PIL import Image

root = r"C:\Users\Lenovo\WorkBuddy\2026-09-29-21-33-32\four-seasons-journey-main\miniprogram\assets"
threshold = 60 * 1024

targets = []
for dirpath, dirnames, filenames in os.walk(root):
    dirnames[:] = [d for d in dirnames if d not in ('packageWorld', 'packageTrip')]
    for fn in filenames:
        if fn.lower().endswith('.jpg'):
            p = os.path.join(dirpath, fn)
            size = os.path.getsize(p)
            if size > threshold:
                targets.append((p, size))

print("=== 压缩前 >60KB 的 jpg ===")
total_before = 0
for p, size in targets:
    total_before += size
    print("  {:>6.0f}KB  {}".format(size / 1024, os.path.relpath(p, root)))

print("=== 压缩中 (quality=70, optimize=True) ===")
total_after = 0
for p, size in targets:
    img = Image.open(p)
    if img.mode != 'RGB':
        img = img.convert('RGB')
    img.save(p, 'JPEG', quality=70, optimize=True)
    new_size = os.path.getsize(p)
    total_after += new_size
    print("  {:>6.0f}KB -> {:>6.0f}KB  {}".format(size / 1024, new_size / 1024, os.path.basename(p)))

print("=== 汇总 ===")
print("  共 {} 张，{:.0f}KB -> {:.0f}KB，节省 {:.0f}KB".format(len(targets), total_before / 1024, total_after / 1024, (total_before - total_after) / 1024))
