#!/usr/bin/env python3
"""
检索某个竞赛/赛事的往届参赛者 GitHub 仓库，并提取公开联系方式。

用法:
    python3 scripts/gh-participant-finder.py \
        --name "全球校园人工智能算法精英大赛" \
        --alias "AIC算法大赛,AIC 算法精英大赛,算法主题赛,算法挑战赛,aicomp" \
        --topics "道路病害目标检测,钢材表面缺陷检测,网络监督细粒度识别" \
        --exclude "AICITY|HCMC|aicompany|aicompanion" \
        --out docs/participants

产出:
    <out>.json   结构化数据（仓库 / 作者 / 邮箱）
    <out>.csv    可直接用 Excel 打开的表格（含「联系状态」列）

关键设计（踩过的坑）:
  1. GitHub Search API 未认证限额 = 10 次/分钟，请求间隔必须 >= 7 秒，否则 403。
  2. 赛事名常与国外同名赛事撞车（如 AIC = AI City Challenge / HCMC AI Challenge），
     必须显式 --exclude 排除，否则结果里一半是噪声。
  3. 很多学生用「赛题名」而非「赛事名」命名仓库，所以要跑 --topics 第二轮。
  4. **邮箱不要去调 GitHub API**（/users 限额仅 60 次/小时，/commits 还不返回真实邮箱）。
     正确做法：`git clone --filter=blob:none --no-checkout --depth=300` 后用
     `git log --format='%ae|%an'` 读，走 git 协议，不受 API 配额限制。
  5. macOS 没有 GNU `timeout` 命令，脚本里不要用（会静默失败，所有 clone 都报错）。
  6. 高校邮箱（@*.edu.cn / @*.edu）回复率显著高于 QQ/163，应在报告里单独列出。
"""

import argparse
import csv
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

UA = {"Accept": "application/vnd.github+json", "User-Agent": "competition-research"}
SEARCH_SLEEP = 7.5  # 未认证 Search API: 10 次/分钟


def gh_search_repos(query, per_page=30, retries=4):
    url = ("https://api.github.com/search/repositories?q="
           + urllib.parse.quote(query) + f"&per_page={per_page}&sort=stars")
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (403, 429):
                wait = 20 * (attempt + 1)
                print(f"    限流，等 {wait}s 重试…", file=sys.stderr)
                time.sleep(wait)
            else:
                print(f"    HTTP {e.code}: {query}", file=sys.stderr)
                return None
        except Exception as e:
            print(f"    错误 {e}: {query}", file=sys.stderr)
            time.sleep(10)
    return None


def fetch_readme(full_name):
    for branch in ("HEAD", "main", "master"):
        for fn in ("README.md", "readme.md", "README.MD", "README.rst", "README.txt"):
            url = f"https://raw.githubusercontent.com/{full_name}/{branch}/{fn}"
            try:
                with urllib.request.urlopen(
                        urllib.request.Request(url, headers={"User-Agent": "research"}), timeout=15) as r:
                    return r.read().decode("utf-8", "ignore")
            except Exception:
                continue
    return ""


def collect_repos(name, aliases, topics, exclude_re, verbose=True):
    seen = {}
    queries = [name] + [a for a in aliases if a]
    for i, q in enumerate(queries + topics, 1):
        d = gh_search_repos(q)
        if d is None:
            continue
        items = d.get("items", [])
        if verbose:
            print(f"  [{i}/{len(queries + topics)}] {q}: total={d.get('total_count')} 取 {len(items)}",
                  file=sys.stderr)
        for it in items:
            fn = it["full_name"]
            if fn in seen:
                seen[fn]["matched_queries"].append(q)
                continue
            seen[fn] = {
                "full_name": fn, "html_url": it["html_url"],
                "description": it.get("description") or "",
                "stars": it["stargazers_count"], "language": it.get("language") or "",
                "pushed_at": (it.get("pushed_at") or "")[:10],
                "matched_queries": [q],
            }
        time.sleep(SEARCH_SLEEP)
    return seen


def classify(repos, name, aliases, exclude_re, verbose=True):
    """判定仓库是否真属于目标赛事。"""
    name_re = re.compile(re.escape(name))
    alias_res = [re.compile(re.escape(a)) for a in aliases if len(a) >= 4]
    confirmed, unknown = [], []
    for r in repos.values():
        if exclude_re and exclude_re.search(r["full_name"]):
            continue
        text = r["full_name"] + " " + r["description"]
        if name_re.search(text) or any(x.search(text) for x in alias_res):
            r["evidence"] = "description"
            confirmed.append(r)
        else:
            unknown.append(r)

    if verbose:
        print(f"  描述直接确认 {len(confirmed)}，待读 README 判定 {len(unknown)}", file=sys.stderr)

    still = []
    for r in unknown:
        rd = fetch_readme(r["full_name"])
        if name_re.search(rd) or any(x.search(rd) for x in alias_res):
            r["evidence"] = "readme"
            confirmed.append(r)
        else:
            r["readme_head"] = rd[:600]
            still.append(r)
        time.sleep(0.3)
    return confirmed, still


def git_author_emails(full_name, workdir):
    """用 git 协议取提交作者邮箱，绕开 GitHub API 配额。"""
    safe = full_name.replace("/", "__")
    d = os.path.join(workdir, safe)
    if not os.path.isdir(os.path.join(d, ".git")):
        env = dict(os.environ, GIT_TERMINAL_PROMPT="0")
        # 注意：不要用 timeout，macOS 上没有这个命令
        subprocess.run(
            ["git", "clone", "--quiet", "--filter=blob:none", "--no-checkout",
             "--depth=300", f"https://github.com/{full_name}.git", d],
            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180)
    if not os.path.isdir(os.path.join(d, ".git")):
        return []
    try:
        out = subprocess.run(
            ["git", "-C", d, "log", "--format=%ae|%an"],
            capture_output=True, text=True, timeout=60).stdout
    except Exception:
        return []
    pairs, seen = [], set()
    for line in out.splitlines():
        if "|" not in line:
            continue
        email, _, author = line.partition("|")
        email = email.strip()
        if not email or email in seen:
            continue
        seen.add(email)
        pairs.append({"email": email, "author": author.strip()})
    return pairs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True, help="赛事全称")
    ap.add_argument("--alias", default="", help="赛事别名/赛道名，逗号分隔")
    ap.add_argument("--topics", default="", help="赛题关键词，逗号分隔")
    ap.add_argument("--exclude", default="", help="排除正则（同名国外赛事等）")
    ap.add_argument("--out", required=True, help="输出路径前缀，不含扩展名")
    ap.add_argument("--workdir", default="/tmp/gh-participant-clones")
    ap.add_argument("--no-clone", action="store_true", help="跳过邮箱抓取")
    args = ap.parse_args()

    aliases = [x.strip() for x in args.alias.split(",") if x.strip()]
    topics = [x.strip() for x in args.topics.split(",") if x.strip()]
    exclude_re = re.compile(args.exclude, re.I) if args.exclude else None

    print(f"[1/4] 检索仓库…", file=sys.stderr)
    repos = collect_repos(args.name, aliases, topics, exclude_re)
    print(f"      唯一仓库 {len(repos)}", file=sys.stderr)

    print(f"[2/4] 判定归属…", file=sys.stderr)
    confirmed, unknown = classify(repos, args.name, aliases, exclude_re)
    confirmed.sort(key=lambda r: -r["stars"])
    print(f"      确认 {len(confirmed)}，存疑 {len(unknown)}", file=sys.stderr)

    BAD = re.compile(r"noreply|@example\.com|^$|copilot", re.I)
    if not args.no_clone:
        print(f"[3/4] 抓取作者邮箱（git 协议）…", file=sys.stderr)
        os.makedirs(args.workdir, exist_ok=True)
        for i, r in enumerate(confirmed, 1):
            pairs = git_author_emails(r["full_name"], args.workdir)
            r["emails"] = [p for p in pairs if not BAD.search(p["email"])]
            if r["emails"]:
                print(f"      [{i}/{len(confirmed)}] {r['full_name']}: {len(r['emails'])} 个邮箱",
                      file=sys.stderr)

    print(f"[4/4] 写出…", file=sys.stderr)
    for r in confirmed:
        r.setdefault("emails", [])
        r["owner"] = r["full_name"].split("/")[0]

    by_owner = {}
    for r in confirmed:
        o = r["owner"]
        b = by_owner.setdefault(o, {"owner": o, "repos": [], "emails": [],
                                    "stars": 0, "desc": r["description"]})
        b["repos"].append(r["full_name"])
        for e in r["emails"]:
            if e["email"] not in [x["email"] for x in b["emails"]]:
                b["emails"].append(e)
        b["stars"] = max(b["stars"], r["stars"])

    with open(args.out + ".json", "w") as f:
        json.dump({"repos": confirmed, "unknown": unknown, "by_owner": list(by_owner.values())},
                  f, ensure_ascii=False, indent=2)

    with open(args.out + ".csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["序号", "作者ID", "主邮箱", "备用邮箱", "仓库", "GitHub主页",
                    "Star", "最后更新", "自述描述", "联系状态", "备注"])
        for i, (o, b) in enumerate(sorted(by_owner.items(),
                                          key=lambda kv: -len(kv[1]["emails"])), 1):
            ems = sorted(b["emails"], key=lambda x: 0 if x["author"].lower() == o.lower() else 1)
            addrs = [x["email"] for x in ems]
            w.writerow([i, o, addrs[0] if addrs else "", "; ".join(addrs[1:]),
                        " ; ".join(b["repos"]), f"https://github.com/{o}",
                        b["stars"], "", b["desc"][:150], "未联系", ""])

    n_email = sum(1 for b in by_owner.values() if b["emails"])
    n_edu = sum(1 for b in by_owner.values()
                if any(re.search(r"@[\w.-]*\.edu(\.cn)?$", e["email"]) for e in b["emails"]))
    print(f"\n完成：{len(confirmed)} 个仓库 / {len(by_owner)} 位作者 / "
          f"{n_email} 位有邮箱 / {n_edu} 位有高校邮箱", file=sys.stderr)
    print(f"  {args.out}.json\n  {args.out}.csv", file=sys.stderr)


if __name__ == "__main__":
    main()
