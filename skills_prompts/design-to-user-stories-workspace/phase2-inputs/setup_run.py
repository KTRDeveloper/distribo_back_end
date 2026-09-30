#!/usr/bin/env python3
"""Create a fresh fixture-b project for a phase-2 eval run.

Usage: setup_run.py <eval> <run-dir>
<eval>: e, f, g, h, j (design from phase2-inputs/<eval>/design.md; statuses below).
The pristine copy goes to <run-dir>/fixture/project (never touched), the working
copy to <run-dir>/outputs/project.
"""
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ZIP = HERE.parent.parent / "dist" / "fixture-b.zip"
DONE = {
    "e": [],
    "f": ["FND-000", "FND-001", "AUTH-001", "SHOP-001"],
    "g": [],
    "h": ["ORD-002"],
    "j": ["FND-000", "FND-001", "AUTH-001", "SHOP-001"],
}


def main():
    name, run = sys.argv[1], Path(sys.argv[2]).resolve()
    for sub in ("fixture", "outputs"):
        target = run / sub
        if target.exists():
            shutil.rmtree(target)
        target.mkdir(parents=True)
        subprocess.run(["unzip", "-q", str(ZIP), "-d", str(target)], check=True)
        project = target / "project"
        status = project / "docs" / "stories" / "STATUS.md"
        text = status.read_text()
        for sid in DONE[name]:
            text = re.sub(rf"^\| {sid} \| todo \|", f"| {sid} | done |", text, flags=re.M)
        status.write_text(text)
        if sub == "outputs":
            shutil.copy(HERE / name / "design.md", project / "docs" / "design.md")
    print(run / "outputs" / "project")


if __name__ == "__main__":
    main()
