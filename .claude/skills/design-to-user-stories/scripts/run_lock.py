#!/usr/bin/env python3
"""One run at a time on an output folder.

Usage:
  run_lock.py acquire --out <folder> --mode init --design <design.md>
  run_lock.py release --out <folder>
  run_lock.py status  --out <folder>

acquire creates <out>/_meta/run.lock. If a lock is already there, the previous
run was interrupted: the lock is taken over, a LEFTOVER line is printed, and
the run resumes from the files on disk. The lock holds no timestamp.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from common import DtusError, read_text, sha256_file, write_text


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("action", choices=["acquire", "release", "status"])
    ap.add_argument("--out", required=True)
    ap.add_argument("--mode", default="init")
    ap.add_argument("--design")
    args = ap.parse_args(argv)
    lock = Path(args.out).resolve() / "_meta" / "run.lock"
    try:
        if args.action == "status":
            print(f"lock held:\n{read_text(lock).strip()}" if lock.exists() else "no lock")
            return 0
        if args.action == "release":
            if lock.exists():
                lock.unlink()
                print("lock released")
            else:
                print("no lock to release")
            return 0
        body = f"mode: {args.mode}\n"
        if args.design:
            body += f"design: {Path(args.design).as_posix()}\ndesign_sha256: {sha256_file(Path(args.design))}\n"
        if lock.exists():
            previous = " ".join(read_text(lock).split())
            write_text(lock, body)
            print(f"LEFTOVER lock from an interrupted run ({previous}). Taken over: report it, "
                  "then resume from the files on disk.")
            return 0
        write_text(lock, body)
        print("lock acquired")
        return 0
    except (DtusError, OSError) as exc:
        print(f"ERROR: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
