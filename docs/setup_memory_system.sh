#!/bin/bash
# setup_memory_system.sh
# ======================
# Run this ONCE in your existing repo to set up the session memory system.
# Usage: bash setup_memory_system.sh
#
# What this does:
#   1. Checks you're in a git repo
#   2. Installs optional dependencies
#   3. Adds hidden state files to .gitignore
#   4. Makes scripts executable
#   5. Gives you the first-run instructions

set -e

echo ""
echo "============================================================"
echo "  Setting up Claude Code Memory System"
echo "============================================================"

# Check we're in a git repo
if ! git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
    echo "  ❌ Error: Not inside a git repository."
    echo "     Run 'git init' first, or cd to your repo root."
    exit 1
fi

REPO_ROOT=$(git rev-parse --show-toplevel)
echo "  ✅ Git repo found: $REPO_ROOT"

# Check Python is available
if command -v python3 &> /dev/null; then
    PYTHON="python3"
elif command -v python &> /dev/null; then
    PYTHON="python"
else
    echo "  ❌ Python not found. Install Python 3.8+ first."
    exit 1
fi
echo "  ✅ Python found: $($PYTHON --version)"

# Install watchdog for test_watcher.py (optional but recommended)
echo ""
echo "  Installing optional dependency: watchdog (for test_watcher.py)"
$PYTHON -m pip install watchdog --quiet && echo "  ✅ watchdog installed" || echo "  ⚠️  watchdog install failed — test_watcher will use polling mode (still works)"

# Add hidden files to .gitignore
echo ""
echo "  Updating .gitignore..."
GITIGNORE="$REPO_ROOT/.gitignore"
touch "$GITIGNORE"

entries=(
    ".session_state.json"
    "*.pyc"
    "__pycache__/"
    ".pytest_cache/"
)

for entry in "${entries[@]}"; do
    if ! grep -qF "$entry" "$GITIGNORE" 2>/dev/null; then
        echo "$entry" >> "$GITIGNORE"
        echo "     Added: $entry"
    else
        echo "     Already present: $entry"
    fi
done
echo "  ✅ .gitignore updated"

# Make scripts executable
chmod +x "$REPO_ROOT/session_manager.py" 2>/dev/null || true
chmod +x "$REPO_ROOT/test_watcher.py" 2>/dev/null || true
echo "  ✅ Scripts made executable"

# Check if CLAUDE.md already has content beyond the template
if [ -f "$REPO_ROOT/CLAUDE.md" ]; then
    lines=$(wc -l < "$REPO_ROOT/CLAUDE.md")
    if [ "$lines" -lt 10 ]; then
        echo "  ⚠️  CLAUDE.md exists but appears empty — fill in your project details"
    else
        echo "  ✅ CLAUDE.md exists ($lines lines)"
    fi
else
    echo "  ⚠️  CLAUDE.md not found — copy it from the template"
fi

echo ""
echo "============================================================"
echo "  SETUP COMPLETE"
echo "============================================================"
echo ""
echo "  IMMEDIATE NEXT STEPS:"
echo ""
echo "  1. Fill in CLAUDE.md with your project details:"
echo "     - What the project does"
echo "     - Current state (what works, what's broken)"
echo "     - Architecture decisions already made"
echo "     - Dead ends you've hit (CRITICAL)"
echo ""
echo "  2. Run your first session:"
echo "     python session_manager.py start"
echo "     [open Claude Code]"
echo "     [do work]"
echo "     python session_manager.py end"
echo ""
echo "  3. Open a second terminal for test watching:"
echo "     python test_watcher.py"
echo ""
echo "  4. When Claude forgets context in a long session:"
echo "     python session_manager.py compact"
echo "     [paste COMPACT.md contents into Claude Code chat]"
echo ""
echo "  5. Check session history anytime:"
echo "     python session_manager.py status"
echo ""
echo "  COMMIT THESE FILES:"
echo "  git add CLAUDE.md session_manager.py test_watcher.py COMPACT.md setup_memory_system.sh"
echo "  git commit -m 'chore: add Claude Code memory system'"
echo ""
echo "============================================================"
