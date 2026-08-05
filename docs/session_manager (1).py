#!/usr/bin/env python3
"""
session_manager.py
==================
Run this at the START and END of every Claude Code session.
It reads your repo state and updates CLAUDE.md automatically.

USAGE:
  python session_manager.py start    # Run before opening Claude Code
  python session_manager.py end      # Run after closing Claude Code
  python session_manager.py status   # Quick status check anytime
  python session_manager.py compact  # Generate COMPACT.md for long sessions

No dependencies beyond Python stdlib + git being installed.
"""

import subprocess
import sys
import os
import json
import datetime
from pathlib import Path


# ── CONFIG ─────────────────────────────────────────────────────────────────────
CLAUDE_MD = Path("CLAUDE.md")
COMPACT_MD = Path("COMPACT.md")
AUDIT_LOG = Path("audit_log.md")
SESSION_STATE = Path(".session_state.json")  # hidden file, add to .gitignore

# Your test command — change this to match your project
TEST_COMMANDS = {
    "python": "pytest tests/ -v --tb=short 2>&1",
    "node":   "npm test 2>&1",
    "auto":   None  # auto-detect below
}

def detect_test_command():
    """Auto-detect the test runner for this project."""
    if Path("pytest.ini").exists() or Path("pyproject.toml").exists() or Path("setup.cfg").exists():
        return "pytest tests/ -v --tb=short 2>&1"
    if Path("package.json").exists():
        pkg = json.loads(Path("package.json").read_text())
        if "scripts" in pkg and "test" in pkg["scripts"]:
            return "npm test 2>&1"
    if Path("Makefile").exists():
        makefile = Path("Makefile").read_text()
        if "test:" in makefile:
            return "make test 2>&1"
    return None


# ── GIT HELPERS ────────────────────────────────────────────────────────────────
def git(cmd: str) -> str:
    """Run a git command, return output."""
    try:
        result = subprocess.run(
            f"git {cmd}", shell=True, capture_output=True, text=True
        )
        return result.stdout.strip()
    except Exception:
        return ""


def get_git_status() -> dict:
    """Get comprehensive git status."""
    return {
        "branch":         git("branch --show-current"),
        "last_commit":    git("log -1 --oneline"),
        "last_commit_ts": git("log -1 --format=%ci"),
        "changed_files":  git("diff --name-only"),
        "staged_files":   git("diff --cached --name-only"),
        "untracked":      git("ls-files --others --exclude-standard"),
        "all_branches":   git("branch -a --format=%(refname:short)"),
        "recent_commits": git("log --oneline -10"),
        "stashes":        git("stash list"),
    }


# ── TEST RUNNER ────────────────────────────────────────────────────────────────
def run_tests() -> dict:
    """Run the test suite and parse results."""
    cmd = detect_test_command()
    if not cmd:
        return {"status": "no_test_command_found", "output": "", "passed": 0, "failed": 0, "errors": 0}

    print(f"  Running: {cmd}")
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=120)
    output = result.stdout + result.stderr

    # Parse pytest output
    passed = failed = errors = 0
    for line in output.split("\n"):
        if "passed" in line and ("failed" in line or "error" in line or "passed" in line):
            parts = line.lower()
            # e.g. "5 passed, 2 failed, 1 error in 3.2s"
            import re
            p = re.search(r"(\d+) passed", parts)
            f = re.search(r"(\d+) failed", parts)
            e = re.search(r"(\d+) error", parts)
            if p: passed = int(p.group(1))
            if f: failed = int(f.group(1))
            if e: errors = int(e.group(1))

    return {
        "status":  "pass" if failed == 0 and errors == 0 else "fail",
        "output":  output[-3000:],  # last 3000 chars to avoid huge files
        "passed":  passed,
        "failed":  failed,
        "errors":  errors,
        "command": cmd,
    }


# ── SESSION STATE ──────────────────────────────────────────────────────────────
def load_session_state() -> dict:
    """Load the persistent session state file."""
    if SESSION_STATE.exists():
        return json.loads(SESSION_STATE.read_text())
    return {
        "session_number": 0,
        "sessions": [],
        "total_tests_run": 0,
    }


def save_session_state(state: dict):
    SESSION_STATE.write_text(json.dumps(state, indent=2, default=str))


# ── COMPACT.md GENERATOR ───────────────────────────────────────────────────────
def generate_compact_md(git_status: dict, test_results: dict, session_state: dict):
    """
    Generate COMPACT.md — a compressed, always-current briefing.
    Paste this into Claude Code when the context window gets long.
    """
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    branch = git_status["branch"]
    last_commit = git_status["last_commit"]
    changed = git_status["changed_files"] or "none"
    t_pass = test_results.get("passed", "?")
    t_fail = test_results.get("failed", "?")
    t_status = "✅" if test_results.get("status") == "pass" else "🔴"

    # Read current CLAUDE.md ONE_THING section
    one_thing = "[check CLAUDE.md for current task]"
    broken = "[check CLAUDE.md for current broken items]"
    if CLAUDE_MD.exists():
        content = CLAUDE_MD.read_text()
        if "THE ONE THING TO DO THIS SESSION" in content:
            section = content.split("THE ONE THING TO DO THIS SESSION")[1].split("---")[0]
            lines = [l.strip() for l in section.strip().split("\n") if l.strip() and not l.startswith("#") and not l.startswith(">")]
            if lines:
                one_thing = lines[0].strip('"').strip("'").strip()
        if "What is BROKEN right now" in content:
            section = content.split("What is BROKEN right now")[1].split("###")[0].split("---")[0]
            broken_lines = [l.strip() for l in section.strip().split("\n") if l.strip().startswith("-")]
            if broken_lines:
                broken = "\n".join(broken_lines[:3])

    compact = f"""# COMPACT.md — Paste this when Claude forgets the context
Generated: {now} | Session #{session_state.get('session_number', '?')}

## RIGHT NOW
- Branch: `{branch}`
- Last commit: {last_commit}
- Tests: {t_status} {t_pass} passing, {t_fail} failing
- Changed files: {changed}

## THIS SESSION'S TASK
{one_thing}

## WHAT IS BROKEN
{broken}

## CRITICAL RULES (do not violate)
- Run tests BEFORE making changes to know baseline
- Work on branch `{branch}` — do NOT create a new branch
- Fix code, never delete tests
- Small steps only — one thing at a time
- If stuck for >10 minutes, stop and update CLAUDE.md with what failed

## READ CLAUDE.md for full context
Full architecture, dead ends, and history are in CLAUDE.md
"""

    COMPACT_MD.write_text(compact)
    print(f"\n  ✅ COMPACT.md updated — paste this into Claude when context gets long\n")
    print(compact)


# ── AUDIT LOG ─────────────────────────────────────────────────────────────────
def append_to_audit_log(event: str, details: dict):
    """Append a structured entry to audit_log.md."""
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    if not AUDIT_LOG.exists():
        AUDIT_LOG.write_text("# Audit Log\nAuto-generated. Do not edit manually.\n\n")

    entry = f"\n## {now} — {event}\n"
    for k, v in details.items():
        if isinstance(v, str) and "\n" in v:
            entry += f"\n**{k}:**\n```\n{v[:500]}\n```\n"
        else:
            entry += f"- **{k}:** {v}\n"

    with open(AUDIT_LOG, "a") as f:
        f.write(entry)


# ── CLAUDE.md UPDATER ─────────────────────────────────────────────────────────
def update_claude_md_session_history(session_num: int, branch: str, test_before: dict, test_after: dict = None, task: str = ""):
    """Append a row to the session history table in CLAUDE.md."""
    if not CLAUDE_MD.exists():
        print("  ⚠️  CLAUDE.md not found. Create it first from the CLAUDE.md template.")
        return

    now = datetime.datetime.now().strftime("%Y-%m-%d")
    t_before = f"{test_before.get('passed', '?')}✅ {test_before.get('failed', '?')}🔴"
    t_after = f"{test_after.get('passed', '?')}✅ {test_after.get('failed', '?')}🔴" if test_after else "N/A"
    outcome = "✅" if (test_after and test_after.get("failed", 1) == 0) else "🔴 check log"

    new_row = f"| {now} | {branch} | {task[:50]} | {outcome} | {t_before} | {t_after} |\n"

    content = CLAUDE_MD.read_text()
    if "| [auto-filled]" in content:
        content = content.replace("| [auto-filled] | | | | | |\n", new_row + "| [auto-filled] | | | | | |\n")
    else:
        # Append to end of session history table
        content += new_row

    CLAUDE_MD.write_text(content)


# ── MAIN COMMANDS ──────────────────────────────────────────────────────────────

def cmd_start():
    """Run at the START of every session."""
    print("\n" + "="*60)
    print("  SESSION START BRIEFING")
    print("="*60)

    state = load_session_state()
    state["session_number"] = state.get("session_number", 0) + 1
    session_num = state["session_number"]

    print(f"\n  Session #{session_num}")
    print(f"  Time: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M')}")

    # Git status
    print("\n  📌 Git status:")
    git_status = get_git_status()
    print(f"     Branch:      {git_status['branch']}")
    print(f"     Last commit: {git_status['last_commit']}")
    if git_status["changed_files"]:
        print(f"     ⚠️  Uncommitted changes: {git_status['changed_files']}")

    # Run tests
    print("\n  🧪 Running tests (baseline before changes)...")
    test_results = run_tests()
    print(f"     Result: {test_results['passed']} passing, {test_results['failed']} failing, {test_results['errors']} errors")

    if test_results["failed"] > 0:
        print(f"\n  ⚠️  TESTS ARE FAILING. Fix these BEFORE adding new features:")
        # Show first failing test
        for line in test_results["output"].split("\n"):
            if "FAILED" in line:
                print(f"     {line}")

    # Save state
    session_record = {
        "session_number": session_num,
        "start_time": datetime.datetime.now().isoformat(),
        "branch": git_status["branch"],
        "tests_at_start": test_results,
    }
    state["current_session"] = session_record
    state["sessions"] = state.get("sessions", [])
    save_session_state(state)

    # Update audit log
    append_to_audit_log("SESSION_START", {
        "session": session_num,
        "branch": git_status["branch"],
        "tests": f"{test_results['passed']} pass, {test_results['failed']} fail",
        "last_commit": git_status["last_commit"],
    })

    # Generate COMPACT.md
    generate_compact_md(git_status, test_results, state)

    print("\n  📖 NEXT STEPS:")
    print("     1. Read CLAUDE.md — check 'THE ONE THING TO DO THIS SESSION'")
    print("     2. Open Claude Code")
    print("     3. Start with: 'Read CLAUDE.md, then [your task]'")
    print("     4. If Claude forgets context → paste COMPACT.md contents")
    print("\n" + "="*60 + "\n")


def cmd_end():
    """Run at the END of every session."""
    print("\n" + "="*60)
    print("  SESSION END — SAVING STATE")
    print("="*60)

    state = load_session_state()
    session_num = state.get("session_number", 0)

    git_status = get_git_status()

    print("\n  🧪 Running tests (final state)...")
    test_results = run_tests()
    print(f"     Result: {test_results['passed']} passing, {test_results['failed']} failing")

    # Ask for task description
    print(f"\n  What was the task this session? (press Enter to skip)")
    try:
        task = input("  > ").strip()
    except (EOFError, KeyboardInterrupt):
        task = "manual update needed"

    # Update session history in CLAUDE.md
    tests_at_start = state.get("current_session", {}).get("tests_at_start", {})
    update_claude_md_session_history(
        session_num,
        git_status["branch"],
        tests_at_start,
        test_results,
        task
    )

    # Save final state
    if "current_session" in state:
        state["current_session"]["end_time"] = datetime.datetime.now().isoformat()
        state["current_session"]["tests_at_end"] = test_results
        state["current_session"]["task"] = task
        state["sessions"].append(state["current_session"])
        del state["current_session"]

    state["total_tests_run"] = state.get("total_tests_run", 0) + 1
    save_session_state(state)

    # Update audit log
    append_to_audit_log("SESSION_END", {
        "session": session_num,
        "task": task,
        "branch": git_status["branch"],
        "tests": f"{test_results['passed']} pass, {test_results['failed']} fail",
        "changed_files": git_status["changed_files"] or "none",
        "last_commit": git_status["last_commit"],
    })

    # Regenerate COMPACT.md for next session
    generate_compact_md(git_status, test_results, state)

    print("\n  ✅ Session saved to CLAUDE.md and audit_log.md")
    print(f"     Tests: {test_results['passed']} passing, {test_results['failed']} failing")
    if test_results["failed"] > 0:
        print("     ⚠️  Session ended with failing tests — fix these first next session")
    print("\n  📋 BEFORE CLOSING:")
    print("     1. Update 'THE ONE THING TO DO THIS SESSION' in CLAUDE.md for next time")
    print("     2. Update 'What is BROKEN' if anything changed")
    print("     3. Commit your work: git add -A && git commit -m 'session " + str(session_num) + ": " + task[:40] + "'")
    print("\n" + "="*60 + "\n")


def cmd_status():
    """Quick status check — no session tracking."""
    print("\n" + "="*60)
    print("  QUICK STATUS")
    print("="*60)

    git_status = get_git_status()
    print(f"\n  Branch:      {git_status['branch']}")
    print(f"  Last commit: {git_status['last_commit']}")
    print(f"\n  Recent commits:")
    for line in git_status["recent_commits"].split("\n")[:5]:
        print(f"     {line}")

    print(f"\n  🧪 Running tests...")
    tests = run_tests()
    print(f"  Tests: {tests['passed']} passing, {tests['failed']} failing, {tests['errors']} errors")

    if tests["failed"] > 0:
        print("\n  Failing tests:")
        for line in tests["output"].split("\n"):
            if "FAILED" in line or "ERROR" in line:
                print(f"  ❌ {line}")
    print("\n" + "="*60 + "\n")


def cmd_compact():
    """Generate COMPACT.md without starting a session."""
    state = load_session_state()
    git_status = get_git_status()
    test_results = run_tests()
    generate_compact_md(git_status, test_results, state)


# ── ENTRY POINT ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1].lower()
    os.chdir(Path(__file__).parent)  # always run from repo root

    if cmd == "start":
        cmd_start()
    elif cmd == "end":
        cmd_end()
    elif cmd == "status":
        cmd_status()
    elif cmd == "compact":
        cmd_compact()
    else:
        print(f"Unknown command: {cmd}")
        print("Usage: python session_manager.py [start|end|status|compact]")
        sys.exit(1)
