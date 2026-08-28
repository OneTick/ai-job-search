#!/usr/bin/env python3
"""
restore.py - ai-job-search bundle 还原脚本

将 archive.py 生成的 .tar.gz 解压到目标目录(默认当前目录)。
覆盖语义: bundle 里有的文件覆盖目标目录中同名文件, 不在 bundle 里的文件保持原样。
不做删除操作, 所以新电脑先 git clone template repo 再 restore, 框架文件 / 工具脚本不丢。

可选 manifest 校验: 默认从 .manifest.json 验证 bundle 整体 SHA256,
                  防止传输损坏。--skip-verify 可关闭(不推荐)。

路径遍历防护: 拒绝任何绝对路径或 '..' 路径。

用法:
    python3 restore.py <bundle.tar.gz> [--target DIR] [--dry-run] [--verbose] [--skip-verify]
"""
import argparse
import hashlib
import json
import os
import sys
import tarfile
from pathlib import Path


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def is_safe_member(member_name, target_root):
    """拒绝任何绝对路径或 '..' 路径遍历。返回 (safe, resolved_path)。"""
    if os.path.isabs(member_name) or member_name.startswith(("/", "\\")):
        return False, None
    parts = member_name.replace("\\", "/").split("/")
    if ".." in parts:
        return False, None
    target_root = Path(target_root).resolve()
    final = (target_root / member_name).resolve()
    try:
        final.relative_to(target_root)
    except ValueError:
        return False, None
    return True, final


def verify_manifest(manifest_path, bundle_path, verbose=False):
    """读 manifest.json 校验 bundle 整体 SHA256。"""
    if not manifest_path.exists():
        print(f"警告: manifest {manifest_path} 不存在, 跳过完整性校验",
              file=sys.stderr)
        return True

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    if "bundle_sha256" in manifest:
        actual = sha256_of(bundle_path)
        if actual != manifest["bundle_sha256"]:
            print(f"错误: bundle SHA256 不匹配", file=sys.stderr)
            print(f"  预期: {manifest['bundle_sha256']}", file=sys.stderr)
            print(f"  实际: {actual}", file=sys.stderr)
            return False
        if verbose:
            print(f"  Bundle SHA256 OK: {actual[:16]}...")

    print(f"  Manifest 文件数: {manifest.get('file_count', '?')}")
    print(f"  源目录:         {manifest.get('source_dir', '?')}")
    print(f"  打包时间:       {manifest.get('created_at', '?')}")
    return True


def main():
    ap = argparse.ArgumentParser(
        description="还原 ai-job-search bundle 到目标目录 (覆盖式, 不删除其他文件)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("bundle", help="bundle 文件路径 (xxx.tar.gz)")
    ap.add_argument("-t", "--target", default=".", help="目标目录 (默认当前目录)")
    ap.add_argument("--dry-run", action="store_true", help="只列出将解压的文件, 不实际写入")
    ap.add_argument("--skip-verify", action="store_true",
                    help="跳过 manifest 完整性校验 (不推荐)")
    ap.add_argument("-v", "--verbose", action="store_true", help="详细输出")
    args = ap.parse_args()

    bundle = Path(args.bundle).resolve()
    if not bundle.exists():
        print(f"错误: bundle {bundle} 不存在", file=sys.stderr)
        sys.exit(1)
    if not (bundle.suffix == ".gz" and bundle.suffixes[-2:] == [".tar", ".gz"]):
        print(f"错误: {bundle} 不是 .tar.gz 文件", file=sys.stderr)
        sys.exit(1)

    target = Path(args.target).resolve()
    if target.exists() and not target.is_dir():
        print(f"错误: 目标 {target} 不是目录", file=sys.stderr)
        sys.exit(1)
    target.mkdir(parents=True, exist_ok=True)

    manifest_path = bundle.with_suffix(".manifest.json")

    if not args.skip_verify:
        print("校验 manifest ...")
        if not verify_manifest(manifest_path, bundle, verbose=args.verbose):
            print("错误: 校验失败, 中止还原", file=sys.stderr)
            sys.exit(1)
    else:
        print("警告: 跳过 manifest 校验", file=sys.stderr)

    if args.dry_run:
        with tarfile.open(bundle, "r:gz") as tar:
            members = tar.getmembers()
            print(f"\n将解压 {len(members)} 个文件到 {target}:")
            for m in members:
                print(f"  {m.name}  ({m.size} bytes)")
        return

    written = 0
    skipped = 0
    with tarfile.open(bundle, "r:gz") as tar:
        for member in tar.getmembers():
            safe, final_path = is_safe_member(member.name, target)
            if not safe:
                print(f"错误: 检测到不安全路径: {member.name}", file=sys.stderr)
                sys.exit(1)
            tar.extract(member, target)
            written += 1
            if args.verbose:
                print(f"解压: {member.name}")

    # 解压后健康检查
    if not args.skip_verify:
        with tarfile.open(bundle, "r:gz") as tar:
            for member in tar.getmembers():
                if not member.isfile():
                    continue
                p = target / member.name
                if not p.exists():
                    print(f"警告: 解压后文件缺失: {member.name}", file=sys.stderr)
                    skipped += 1
                    continue
                if p.stat().st_size != member.size:
                    print(f"警告: 大小不一致: {member.name} "
                          f"(tar={member.size}, disk={p.stat().st_size})",
                          file=sys.stderr)
                    skipped += 1

    print(f"\n[OK] Bundle 还原成功: {bundle} -> {target}")
    print(f"   解压文件:     {written}")
    if skipped:
        print(f"   校验告警:     {skipped}")
    print(f"   现有文件被覆盖, bundle 不包含的文件保持原样")


if __name__ == "__main__":
    main()
