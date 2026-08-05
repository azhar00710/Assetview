# HOW_TO_USE.md — Quick Reference
# =================================
# The 5-minute guide to using the session memory system

## DAILY WORKFLOW (do this every single session)

### BEFORE opening Claude Code:
```bash
python session_manager.py start
```
This will:
- Show you what branch you're on
- Run your tests and show which are failing
- Print a briefing of current state
- Generate COMPACT.md (the context rescue file)
- Tell you exactly what to do this session

### OPEN Claude Code and start with this exact message:
```
Read CLAUDE.md first. Then [paste your specific task from CLAUDE.md].
Do not create a new branch. Work on [branch name from session start output].
Run the existing tests first before making any changes.
```

### WHEN Claude forgets (context gets long):
```bash
python session_manager.py compact
```
Then paste the contents of COMPACT.md into the Claude Code chat:
```
You seem to have lost context. Here is the current briefing: [paste COMPACT.md]
```

### AFTER closing Claude Code:
```bash
python session_manager.py end
```
Then manually update CLAUDE.md:
- Update "THE ONE THING TO DO THIS SESSION" for next time
- Update "What is BROKEN" if anything changed
- Add any new dead ends to the dead ends table

### Commit your work:
```bash
git add -A
git commit -m "session [N]: [what you did in plain English]"
```

---

## SEPARATE TERMINAL — run this while working:
```bash
python test_watcher.py
```
This watches your files and runs tests automatically whenever you save.
You'll see immediately if Claude Code's changes break anything.

---

## THE RULES (Claude Code must follow these — put them in CLAUDE.md)

1. **Read CLAUDE.md before doing anything else**
2. **Run existing tests before making any changes** — establish the baseline
3. **Work on the current branch — never create a new branch without permission**
4. **Fix code, not tests** — if a test fails, fix the code that makes it fail
5. **One small task per session** — finish it completely before starting another
6. **If blocked for 10+ minutes, stop and document the blocker in CLAUDE.md**
7. **Never delete existing functionality to make tests pass**
8. **Commit at the end of every session, even partial work**

---

## FIXING THE 100-BRANCH PROBLEM

You currently have ~100 branches. Here's how to clean up:

```bash
# See all your branches
git branch -a

# Find which ones have been merged to main
git branch --merged main

# Delete merged branches (safe)
git branch --merged main | grep -v "main" | xargs git branch -d

# For unmerged branches — check each one
git log main..branch-name --oneline
# If it has nothing useful, delete it:
git branch -D branch-name
```

Going forward: maximum 2-3 active branches at any time.
One per feature in progress. Merge and delete when done.

---

## HOW TO HANDLE THE CONTEXT WINDOW PROBLEM

The problem: Claude Code reads your whole conversation from the top.
When conversations get very long, the beginning (your original instructions)
gets compressed and effectively forgotten.

The fix has three parts:

**Part 1: COMPACT.md (already set up)**
Run `python session_manager.py compact` to regenerate.
Paste it in whenever you notice Claude drifting.

**Part 2: Start fresh sessions for new topics**
Don't extend a session that's already 2+ hours old.
End the session (save state), start a new one.

**Part 3: Keep instructions at the BOTTOM, not the top**
Claude Code reads context most reliably from the most recent messages.
If you need to re-establish rules, type them again at the bottom
of the conversation, not just once at the top.

---

## SIGNS CLAUDE CODE IS RUNNING OUT OF CONTEXT

- It starts asking questions it already answered 30 minutes ago
- It suggests creating a new branch when you told it not to
- It's trying a solution you already told it failed
- It doesn't seem to know what file it was working on
- Its code suggestions seem to not match the existing codebase structure

When you see these signs: run `python session_manager.py compact`
and paste COMPACT.md into the chat before continuing.
