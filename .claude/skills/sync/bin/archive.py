#!/usr/bin/env python3
"""
archive.py - ai-job-search 工作目录打包脚本

扫描源目录(默认当前目录)按 INCLUDE_PATTERNS 收集个人化产出物,
按 EXCLUDE_PATTERNS 排除 framework 通用文件 / 编译产物 / 依赖目录,
生成 .tar.gz + 配套 manifest.json,带 SHA256 校验和。

默认输出: ~/.ai-job-search-bundles/bundle-YYYY-MM-DD-HHMM.tar.gz

用法:
    python3 archive.py [--source DIR] [--output PATH] [--dry-run] [--verbose]
"""
import argparse
import datetime
import fnmatch
import hashlib
import json
import os
import sys
import tarfile
from pathlib import Path

# ---------------------------------------------------------------------------
# 配置: 自定义时改这里
# ---------------------------------------------------------------------------

# 包含的路径模式(POSIX glob 风格, 相对源目录)
INCLUDE_PATTERNS = [
    "CLAUDE.md",
    ".claude/skills/job-application-assistant/01-candidate-profile.md",
    ".claude/skills/job-application-assistant/02-behavioral-profile.md",
    ".claude/skills/job-application-assistant/04-job-evaluation.md",
    ".claude/skills/job-application-assistant/05-cv-templates.md",
    ".claude/skills/job-application-assistant/06-cover-letter-templates.md",
    ".claude/skills/job-application-assistant/07-interview-prep.md",
    ".claude/skills/job-scraper/search-queries.md",
    "cv/*.tex",
    "cover_letters/*.tex",
    "documents/**/*",
    "company_research/*.json",
    "applications/**/*",
    "seen_jobs.json",
    "tools/**/*",
]

# 排除的路径模式(优先级高于 INCLUDE)
EXCLUDE_PATTERNS = [
    ".git",
    ".git/**",
    "**/node_modules/**",
    "**/__pycache__/**",
    "**/*.pyc",
    "**/*.pyo",
    "**/*.pyd",
    "**/bun.lockb",
    "**/package-lock.json",
    "**/yarn.lock",
    "**/pnpm-lock.yaml",
    # LaTeX 编译产物
    "**/*.pdf",
    "**/*.aux",
    "**/*.log",
    "**/*.out",
    "**/*.synctex.gz",
    "**/*.bbl",
    "**/*.blg",
    "**/*.toc",
    "**/*.fls",
    "**/*.fdb_latexmk",
    "**/*.nav",
    "**/*.snm",
    "**/*.vrb",
    "**/*.xdv",
    "**/*.run.xml",
    "**/*.bcf",
    # 临时 / 系统文件
    "**/.DS_Store",
    "**/Thumbs.db",
    "**/*~",
    "**/*.swp",
    "**/*.swo",
    "**/*.bak",
    "**/*.tmp",
    # 输出 / 编译目录
    "**/dist/**",
    "**/build/**",
    "**/.cache/**",
    "**/.pytest_cache/**",
]

# 排除 framework 通用文件(每台电脑从 template repo 同步)
EXCLUDE_FRAMEWORK_FILES = {
    ".claude/skills/job-application-assistant/03-writing-style.md",
    ".claude/skills/job-application-assistant/SKILL.md",
    ".claude/skills/job-scraper/SKILL.md",
    ".claude/skills/job-scraper/README.md",
    ".claude/skills/job-application-assistant/README.md",
}

# ---------------------------------------------------------------------------
# 核心逻辑
# ---------------------------------------------------------------------------

def matches_any(path_str, patterns):
    """POSIX 路径是否匹配 glob 模式列表中的任意一个。"""
    norm = path_str.replace(os.sep, "/")
    for pat in patterns:
        if fnmatch.fnmatch(norm, pat):
            return True
        # **/x 等价于 x (跨任意前缀)
        if pat.startswith("**/") and fnmatch.fnmatch(norm, pat[3:]):
            return True
        # x/** 等价于 x/ 下的所有内容
        if pat.endswith("/**") and norm.startswith(pat[:-3] + "/"):
            return True
    return False


def should_include(rel_posix):
    """根据 INCLUDE / EXCLUDE 决定是否打包。"""
    if rel_posix in EXCLUDE_FRAMEWORK_FILES:
        return False
    if matches_any(rel_posix, EXCLUDE_PATTERNS):
        return False
    if not matches_any(rel_posix, INCLUDE_PATTERNS):
        return False
    return True


def should_descend(dir_rel_posix):
    """目录是否值得递归进去。
    优化点: 整个目录被 EXCLUDE 时直接跳过(避免遍历 node_modules 等大型目录)。"""
    if dir_rel_posix in EXCLUDE_FRAMEWORK_FILES:
        return False
    # 目录本身或其下任何东西被排除 → 不必进入
    if matches_any(dir_rel_posix, EXCLUDE_PATTERNS):
        return False
    # 检查 EXCLUDE 模式中以 "目录/" 开头的情况
    for pat in EXCLUDE_PATTERNS:
        if pat.endswith("/**") and dir_rel_posix == pat[:-3]:
            return False
    return True


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def collect_files(source, compute_hash=True):
    """遍历 source, 返回 [(rel_posix, abs_path, size, sha256_or_None)] 列表。
    compute_hash=False 用于 dry-run 加速。"""
    out = []
    for dirpath, dirnames, filenames in os.walk(source):
        # 原地裁剪 dirnames: 跳过不该进入的子目录
        rel_dir = os.path.relpath(dirpath, source)
        if rel_dir == ".":
            rel_dir_posix = ""
        else:
            rel_dir_posix = rel_dir.replace(os.sep, "/")
        kept = []
        for dn in dirnames:
            child_posix = (rel_dir_posix + "/" + dn) if rel_dir_posix else dn
            if should_descend(child_posix):
                kept.append(dn)
        dirnames[:] = kept

        for fn in filenames:
            full = Path(dirpath) / fn
            rel = full.relative_to(source)
            rel_posix = str(rel).replace(os.sep, "/")
            if not should_include(rel_posix):
                continue
            size = full.stat().st_size
            h = sha256_of(full) if compute_hash else None
            out.append((rel_posix, full, size, h))
    out.sort(key=lambda x: x[0])
    return out


def default_output_path():
    bundle_dir = Path.home() / ".ai-job-search-bundles"
    bundle_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.datetime.now().strftime("%Y-%m-%d-%H%M%S")
    return bundle_dir / f"bundle-{ts}.tar.gz"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(
        description="打包 ai-job-search 工作目录的个人化产出物 (.tar.gz + manifest.json)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("-s", "--source", default=".", help="源目录(默认当前目录)")
    ap.add_argument("-o", "--output", default=None,
                    help="输出 bundle 路径(默认 ~/.ai-job-search-bundles/bundle-<timestamp>.tar.gz)")
    ap.add_argument("--dry-run", action="store_true", help="只列出将包含的文件, 不实际生成 bundle")
    ap.add_argument("-v", "--verbose", action="store_true", help="详细输出")
    args = ap.parse_args()

    source = Path(args.source).resolve()
    if not source.is_dir():
        print(f"错误: 源目录 {source} 不存在或不是目录", file=sys.stderr)
        sys.exit(1)

    output = Path(args.output).resolve() if args.output else default_output_path()

    # dry-run 跳过 SHA256 计算以加速
    files = collect_files(source, compute_hash=not args.dry_run)

    if args.dry_run:
        print(f"将打包 {len(files)} 个文件 (源目录: {source}):")
        for rel, _, size, _ in files:
            print(f"  {rel}  ({size} bytes)")
        total = sum(s for _, _, s, _ in files)
        print(f"\n总大小: {total} bytes ({total / 1024 / 1024:.2f} MB)")
        print(f"将输出到: {output}")
        return

    # 实际打包
    output.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(output, "w:gz") as tar:
        for rel, abs_path, _, _ in files:
            tar.add(abs_path, arcname=rel)
            if args.verbose:
                print(f"添加: {rel}")

    bundle_sha = sha256_of(output)
    total_size = sum(s for _, _, s, _ in files)

    manifest = {
        "version": "1.0",
        "created_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "source_dir": str(source),
        "file_count": len(files),
        "total_size_bytes": total_size,
        "total_size_mb": round(total_size / 1024 / 1024, 2),
        "bundle_sha256": bundle_sha,
        "files": [
            {"path": rel, "size": size, "sha256": h}
            for rel, _, size, h in files
        ],
    }
    manifest_path = output.with_suffix(".manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print(f"\n[OK] Bundle 创建成功: {output}")
    print(f"   Manifest:       {manifest_path}")
    print(f"   File count:     {len(files)}")
    print(f"   Raw size:       {total_size} bytes ({total_size / 1024 / 1024:.2f} MB)")
    print(f"   Compressed:     {output.stat().st_size} bytes")
    print(f"   Bundle SHA256:  {bundle_sha}")


if __name__ == "__main__":
    main()
