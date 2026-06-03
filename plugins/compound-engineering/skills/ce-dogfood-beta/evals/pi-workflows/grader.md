# Pi workflow dogfood grader

This grader evaluates runtime evidence for the Pi workflow smoke matrix. It grades observed behavior against the capability taxonomy used by `ce-setup` and the core workflow skills.

## Inputs

For each run, receive:

1. The eval case from `evals.json`.
2. The run record with `pi_root`, `pi_root_kind`, `extension_set`, `session_freshness`, `ce_setup_matrix`, `capability_evidence`, and transcript excerpt paths.
3. Any operator notes about skipped cases, real-home backup/restore, or unavailable interactive Pi sessions.

## Safety gate

Before functional grading, enforce the safety gate:

- **Pass** if `pi_root_kind` is `temp`.
- **Pass** if `pi_root_kind` is `real_with_backup` and the run record includes `backup_path`, `restore_plan`, and explicit operator opt-in.
- **Fail** if the run mutates `~/.pi/agent` or another real Pi root by default without backup evidence.

A safety failure makes the whole run fail regardless of functional behavior.

## Capability evidence statuses

Use these evidence values per capability row:

| Evidence | Meaning |
|---|---|
| `invoked` | The runtime tool was actually called in the active session |
| `found_on_disk` | `ce-setup` or filesystem checks found an installed package, but active tool exposure was not proven |
| `fallback_used` | The workflow used the documented native/chat fallback because a tool was absent or errored |
| `unavailable` | The tool was absent and no fallback evidence was shown |
| `not_applicable` | The case did not exercise the capability by design |

Empty results are not failures: empty diagnostics, zero structural matches, no recall results, and no web results count as valid `invoked` evidence when the tool call completed and the workflow interpreted the result correctly.

## Row-level grading

### Subagent delegation

- **Pass**: In cases with `pi-subagents`, evidence shows `subagent` was invoked or the matrix reports `active-or-unverified` with a fresh-session transcript showing delegation was available.
- **Degraded**: Matrix reports `blocked` only in `missing-extensions`; workflow clearly avoids persona fan-out or reports delegation as blocked.
- **Fail**: Delegation is blocked in any case where `pi-subagents` is installed and a fresh session was required.

### Structured questions

- **Pass**: `ask_user_question` is invoked for 2-4 options when installed; 5+ options or multi-select overflow uses numbered-list fallback.
- **Degraded**: Tool is absent and numbered-list fallback is used clearly.
- **Fail**: The workflow silently skips a needed question or trims meaningful options only to fit the tool cap.

### Task tracking

- **Pass**: `todo` is invoked when installed for multi-step work.
- **Degraded**: Tool is absent and task state is kept in transcript or a local TODO artifact.
- **Fail**: Multi-step work loses track of state or optional absence blocks progress.

### Web research

- **Pass**: `web_search`, `fetch_content`, `code_search`, or `get_search_content` is invoked when installed and relevant.
- **Degraded**: Web tools are absent; workflow proceeds from local repo evidence and states missing external context.
- **Fail**: Workflow claims web-grounded conclusions without web evidence or blocks when web access is optional.

### Large-output compression and persistent/session recall

- **Pass**: `ctx_batch_execute`, `ctx_execute`, `ctx_execute_file`, `ctx_search`, or `ctx_index` is invoked when context-mode is installed and relevant.
- **Degraded**: context-mode is absent or stale-session unavailable; workflow uses bounded native output and concise summaries.
- **Fail**: Large raw output is dumped into the transcript, no-match recall is treated as a tool failure, or context-mode absence blocks progress.

### Symbol diagnostics/navigation and structural search/edit

- **Pass**: `lsp_diagnostics`, `lsp_navigation`, `ast_grep_search`, or `ast_grep_replace` is invoked when pi-lens is installed and relevant. Empty diagnostics and zero matches count as successful evidence.
- **Degraded**: pi-lens is absent or stale-session unavailable; workflow falls back to targeted source reads/search/edit.
- **Fail**: pi-lens absence blocks code work, empty results are misreported as failures, or structural edits are attempted blindly.

### CE artifact presence and matrix output

- **Pass**: `ce-setup` matrix includes every capability row from `evals.json` and CE artifacts are reported as `installed` for converted-plugin cases.
- **Degraded**: CE artifacts are partial and the matrix reports `degraded` with paths.
- **Fail**: Matrix omits rows, reports optional accelerators as generic setup failures, or cannot distinguish installed-on-disk from active-session exposure.

## Overall run result

- **Pass**: Safety gate passes, required delegation behaves as expected for the case, all applicable installed optional capabilities are invoked or explicitly found-on-disk with a reason active invocation was not possible, and all absent capabilities use documented fallback.
- **Degraded**: Safety gate passes and required delegation is correct, but optional capabilities are absent, stale, or only found on disk. The workflow remains usable and honest about fallback.
- **Fail**: Safety gate fails, required delegation is wrong, optional absence blocks progress, stale-session behavior is misrepresented as fresh, or `ce-setup` matrix output contradicts observed behavior.

## Aggregate interpretation

| Aggregate pattern | Interpretation | Action |
|---|---|---|
| All cases pass/degraded as expected | Pi expert workflow posture is working | Ship with captured evidence |
| Missing/partial cases fail because workflows block on optional tools | Fallback contract is broken | Fix skill guidance or converter output |
| Full-accelerator case does not invoke `ctx_*` or pi-lens tools | Preference contract is not reaching runtime | Tighten skill guidance or agent tool exposure |
| Stale-session case reports tools as active without caveat | Matrix wording is overconfident | Change status wording or dogfood instructions |
| Real-home safety gate fails | Eval process is unsafe | Stop and rewrite operator instructions before more runs |
