# Pi workflow dogfood eval suite

## Purpose

Validate that Compound Engineering's Pi runtime behaves like an expert Pi workflow, not merely that converted files exist. The suite checks whether required Pi delegation works, optional accelerators are preferred when present, degraded states remain usable, and `ce-setup` reports the same capability taxonomy the skills rely on.

This is a manual/runtime smoke matrix. CI should validate the file contracts, but it should not mutate a user's real Pi home or launch interactive Pi sessions by default.

## Files

| File | Purpose |
|------|---------|
| `evals.json` | Smoke cases covering extension combinations, expected capability status, and evidence fields to capture |
| `grader.md` | Rubric for pass/degraded/fail outcomes and aggregate interpretation |
| `README.md` | Operator flow and safety instructions |

## Safety defaults

Run against a temporary Pi home unless explicitly testing an existing install:

```bash
export PI_EVAL_HOME="$(mktemp -d -t ce-pi-eval-XXXXXX)"
export PI_HOME="$PI_EVAL_HOME/.pi/agent"
mkdir -p "$PI_HOME"
```

Do **not** mutate `~/.pi/agent` by default. If a real-home run is necessary, first back up the real Pi root, record the backup path, and require an explicit operator note in the run record. A run record without either `pi_root_kind: "temp"` or a `backup_path` is invalid.

## Operator flow

1. Create a fresh temp Pi root (`PI_HOME`) for the case, or document an explicit backup/restore plan for a real root.
2. Install or remove Pi extensions listed in the case's `extension_set` against that root.
3. Install the current branch's converted Compound Engineering plugin into the same root.
4. Start a **fresh Pi session** for cases that require active-session evidence. For stale-session cases, intentionally keep the pre-install session open and record that it is stale.
5. Run `ce-setup` and capture the Pi capability matrix.
6. Invoke the case prompt and capture whether each capability was actually invoked, merely found on disk, unavailable, or skipped.
7. Grade with `grader.md` and write a run record with the Pi root, extension set, session freshness, capability evidence, and any skipped matrix rows.

## Evidence to capture

Each run record should include:

- `pi_root` and `pi_root_kind` (`temp` or `real_with_backup`)
- `extension_set` exactly as installed for the case
- `session_freshness` (`fresh_after_install` or `stale_after_install`)
- `ce_setup_matrix` text or artifact path
- `capability_evidence` per taxonomy row: `invoked`, `found_on_disk`, `unavailable`, `fallback_used`, or `not_applicable`
- `transcript_excerpt_paths` for active-session proof; store excerpts under `/tmp/compound-engineering/ce-dogfood-beta/pi-workflows/<run-id>/`

## Smoke cases at a glance

| Case | Extension state | Expected outcome |
|------|-----------------|------------------|
| `missing-extensions` | No Pi extensions | Delegation blocked, optional rows degraded, workflows use fallbacks |
| `subagents-only` | `pi-subagents` only | Delegation works, questions/task/web/context/lens degraded |
| `subagents-plus-questions` | `pi-subagents` + `ask_user_question` | Delegation and structured questions work; 5-option overflow uses numbered fallback |
| `recommended-no-accelerators` | Required/recommended/web/task extensions, no context-mode or pi-lens | Core workflows usable; accelerator rows degraded with native fallback |
| `full-accelerators` | Required/recommended plus context-mode and pi-lens | Work/debug/review prefer `ctx_*`, `lsp_*`, and `ast_grep_*` tools |
| `stale-session-after-install` | Extensions installed after session start | Disk checks may show installed, active tools remain unavailable until session refresh |

## Interpreting outcomes

- **Pass**: Required capability works, expected optional tools are invoked when present, degraded rows use the documented fallback, and `ce-setup` matrix matches observed behavior.
- **Degraded**: Required delegation works but one or more optional capabilities are absent or only found on disk. The workflow remains usable and reports fallback clearly.
- **Fail**: Required delegation is blocked in a case where it should work, optional tool absence makes the workflow impossible, stale sessions are reported as fresh, or the run mutates real `~/.pi/agent` without an explicit backup.
