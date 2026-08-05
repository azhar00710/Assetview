# Central Hub Required Checks (Branch Protection)

This document defines the recommended GitHub required status checks for Central Engineering Hub changes.

## Goal

Block merges that break central-hub integration, idempotency, approval workflow, or publishing behavior.

## Required workflow

Set this workflow as a required status check on protected branches:

- `Central Hub Smoke Test / central-hub-smoke`

The check is produced by:

- `.github/workflows/central-hub-smoke.yml`

## Recommended branch protection settings

Apply to `main` (and release branches if used):

- Require a pull request before merging.
- Require approvals (recommended: minimum 1-2 reviewers).
- Require status checks to pass before merging.
- Require branches to be up to date before merging.
- Include administrators (recommended for consistency).

## Suggested required checks set (current)

- `Central Hub Smoke Test / central-hub-smoke`

Optional additional checks (if enabled in your repo):

- backend unit tests
- frontend build/lint
- security/dependency scanning

## When to update this list

Update this document when:

- central-hub CI workflows are renamed,
- new central-hub critical checks are added,
- branch strategy changes (e.g., release/hotfix flows).

## Fast setup steps in GitHub UI

1. Go to repository `Settings` -> `Branches`.
2. Edit branch protection rule for `main`.
3. Enable **Require status checks to pass before merging**.
4. Add required check:
   - `Central Hub Smoke Test / central-hub-smoke`
5. Save rule.

