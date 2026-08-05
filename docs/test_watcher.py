#!/usr/bin/env python3
"""
test_watcher.py
===============
Watches your source files and runs tests automatically when anything changes.
Run this in a SEPARATE terminal alongside Claude Code.

USAGE:
  python test_watcher.py          # Watch and run tests on change
  python test_watcher.py --once   # Run tests once and exit

INSTALL watchdog first (one time):
  pip install watchdog
"""

import subprocess
import sys
import time
import os
import datetime
from pathlib import Path


# ── CONFIG — CHANGE THESE ─────────────────────────────────────────────────────
WATCH_DIRS = ["src", "app", "lib", "tests", "."]  # dirs to watch for changes
WATCH_EXTENSIONS = [".py", ".ts", ".js", ".tsx", ".jsx"]
IGNORE_DIRS = ["node_modules", ".git", "__pycache__", ".pytest_cache", "dist", "build"]

TEST_COMMAND = None  # None = auto-detect

VALIDATION_COMMANDS = [
    # Add any linting/type-checking you want to run alongside tests
    # e.g. ("Type check", "npx tsc --noEmit 2>&1")
    # e.g. ("Lint", "flake8 src/ 2>&1")
]
# ─────────────────────────────────────────────────────────────────────────────


def detect_test_command():
    if TEST_COMMAND:
        return TEST_COMMAND
    if Path("pytest.ini").exists() or Path("pyproject.toml").exists():
        return "pytest tests/ -v --tb=short"
    if Path("package.json").exists():
        return "npm test --watchAll=false"
    return None


def run_with_output(cmd: str, label: str = "Tests") -> bool:
    """Run a command and print output in real time. Returns True if passed."""
    now = datetime.datetime.now().strftime("%H:%M:%S")
    print(f"\n{'='*60}")
    print(f"  {now} | {label}")
    print(f"  Running: {cmd}")
    print(f"{'='*60}")

    result = subprocess.run(cmd, shell=True, capture_output=False)
    passed = result.returncode == 0

    print(f"\n  {'✅ PASSED' if passed else '🔴 FAILED'}")
    return passed


def run_all_checks():
    """Run tests + all validation commands."""
    cmd = detect_test_command()
    if not cmd:
        print("  ⚠️  No test command found. Set TEST_COMMAND in test_watcher.py")
        return

    all_passed = run_with_output(cmd, "Tests")

    for label, val_cmd in VALIDATION_COMMANDS:
        passed = run_with_output(val_cmd, label)
        all_passed = all_passed and passed

    if all_passed:
        print("\n  ✅ ALL CHECKS PASSED")
    else:
        print("\n  🔴 SOME CHECKS FAILED — fix these before continuing")

    return all_passed


# ── FILE WATCHER ──────────────────────────────────────────────────────────────
def watch_mode():
    try:
        from watchdog.observers import Observer
        from watchdog.events import FileSystemEventHandler
    except ImportError:
        print("  watchdog not installed. Run: pip install watchdog")
        print("  Falling back to polling mode (checks every 3 seconds)...")
        poll_mode()
        return

    last_run = [0]
    DEBOUNCE_SECONDS = 1.5

    class ChangeHandler(FileSystemEventHandler):
        def on_modified(self, event):
            if event.is_directory:
                return
            path = Path(event.src_path)
            # Check extension
            if path.suffix not in WATCH_EXTENSIONS:
                return
            # Check ignore dirs
            for ignore in IGNORE_DIRS:
                if ignore in str(path):
                    return
            # Debounce
            now = time.time()
            if now - last_run[0] < DEBOUNCE_SECONDS:
                return
            last_run[0] = now

            print(f"\n  📝 Changed: {path}")
            run_all_checks()

    observer = Observer()
    for watch_dir in WATCH_DIRS:
        d = Path(watch_dir)
        if d.exists():
            observer.schedule(ChangeHandler(), str(d), recursive=True)

    print(f"  👁️  Watching for changes in: {', '.join(WATCH_DIRS)}")
    print(f"  Extensions: {', '.join(WATCH_EXTENSIONS)}")
    print(f"  Press Ctrl+C to stop\n")

    # Run once immediately
    run_all_checks()

    observer.start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()


def poll_mode():
    """Fallback polling mode — no watchdog needed."""
    print(f"  👁️  Polling for changes every 3 seconds...")
    print(f"  Press Ctrl+C to stop\n")

    last_mtimes = {}

    def get_mtimes():
        mtimes = {}
        for watch_dir in WATCH_DIRS:
            d = Path(watch_dir)
            if not d.exists():
                continue
            for f in d.rglob("*"):
                if f.is_file() and f.suffix in WATCH_EXTENSIONS:
                    skip = False
                    for ignore in IGNORE_DIRS:
                        if ignore in str(f):
                            skip = True
                            break
                    if not skip:
                        try:
                            mtimes[str(f)] = f.stat().st_mtime
                        except Exception:
                            pass
        return mtimes

    last_mtimes = get_mtimes()
    run_all_checks()

    while True:
        time.sleep(3)
        current = get_mtimes()
        changed = [f for f in current if current[f] != last_mtimes.get(f)]
        if changed:
            print(f"\n  📝 Changed: {', '.join(changed[:3])}")
            run_all_checks()
            last_mtimes = current


if __name__ == "__main__":
    os.chdir(Path(__file__).parent)

    if "--once" in sys.argv:
        run_all_checks()
    else:
        watch_mode()
