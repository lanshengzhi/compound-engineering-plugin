import { describe, expect, test } from "bun:test"
import { promises as fs } from "fs"
import path from "path"

const suiteRoot = path.join(
  import.meta.dir,
  "..",
  "plugins",
  "compound-engineering",
  "skills",
  "ce-dogfood-beta",
  "evals",
  "pi-workflows",
)

type EvalCase = {
  id: string
  state: string
  pi_root_kind: string
  extension_set: string[]
  session_freshness: string
  expected_matrix: Record<string, string>
  expected_evidence: string[]
}

type EvalSuite = {
  safety_policy: {
    default_pi_root: string
    real_home_mutation: string
    valid_real_home_run_requires: string[]
  }
  capability_rows: string[]
  run_record_required_fields: string[]
  evals: EvalCase[]
}

async function readSuite(): Promise<EvalSuite> {
  return JSON.parse(await fs.readFile(path.join(suiteRoot, "evals.json"), "utf8")) as EvalSuite
}

describe("Pi runtime dogfood eval contract", () => {
  test("eval JSON includes the required smoke matrix states", async () => {
    const suite = await readSuite()
    const states = new Set(suite.evals.map((entry) => entry.state))
    for (const state of ["missing", "partial", "accelerator_absent", "accelerator_present", "stale_session"]) {
      expect(states.has(state), `missing state ${state}`).toBe(true)
    }

    const ids = new Set(suite.evals.map((entry) => entry.id))
    for (const id of [
      "missing-extensions",
      "subagents-only",
      "subagents-plus-questions",
      "recommended-no-accelerators",
      "full-accelerators",
      "stale-session-after-install",
    ]) {
      expect(ids.has(id), `missing eval ${id}`).toBe(true)
    }
  })

  test("all cases record capability rows, extension sets, session freshness, and evidence", async () => {
    const suite = await readSuite()
    const requiredRows = [
      "Subagent delegation",
      "Structured questions",
      "Task tracking",
      "Web research",
      "Large-output compression",
      "Persistent/session recall",
      "Symbol diagnostics/navigation",
      "Structural search/edit",
      "CE artifact presence",
    ]

    expect(suite.capability_rows).toEqual(requiredRows)
    for (const field of ["pi_root", "pi_root_kind", "extension_set", "session_freshness", "ce_setup_matrix", "capability_evidence"]) {
      expect(suite.run_record_required_fields).toContain(field)
    }

    const allowedStatuses = new Set(["blocked", "degraded", "active-or-unverified", "installed", "missing"])
    for (const evalCase of suite.evals) {
      expect(evalCase.pi_root_kind).toBe("temp")
      expect(["fresh_after_install", "stale_after_install"]).toContain(evalCase.session_freshness)
      expect(Array.isArray(evalCase.extension_set)).toBe(true)
      expect(evalCase.expected_evidence.length).toBeGreaterThan(0)
      for (const row of requiredRows) {
        const status = evalCase.expected_matrix[row]
        expect(status, `${evalCase.id} missing ${row}`).toBeDefined()
        expect(allowedStatuses.has(status), `${evalCase.id} invalid status for ${row}`).toBe(true)
      }
      const installed = new Set(evalCase.extension_set)
      expect(evalCase.expected_matrix["Subagent delegation"]).toBe(
        installed.has("pi-subagents") ? "active-or-unverified" : "blocked",
      )
      expect(evalCase.expected_matrix["Large-output compression"]).toBe(
        installed.has("context-mode") ? "active-or-unverified" : "degraded",
      )
      expect(evalCase.expected_matrix["Structural search/edit"]).toBe(
        installed.has("pi-lens") ? "active-or-unverified" : "degraded",
      )
    }
  })

  test("README defaults to temp Pi homes and forbids real-home mutation by default", async () => {
    const readme = await fs.readFile(path.join(suiteRoot, "README.md"), "utf8")
    const suite = await readSuite()

    expect(suite.safety_policy.default_pi_root).toBe("temporary")
    expect(suite.safety_policy.real_home_mutation).toBe("forbidden_by_default")
    expect(suite.safety_policy.valid_real_home_run_requires).toEqual([
      "explicit_operator_opt_in",
      "backup_path",
      "restore_plan",
    ])
    expect(readme).toContain("mktemp -d")
    expect(readme).toContain("Do **not** mutate `~/.pi/agent` by default")
    expect(readme).toContain("backup_path")
  })

  test("grader defines pass, degraded, and fail outcomes for core Pi evidence", async () => {
    const grader = await fs.readFile(path.join(suiteRoot, "grader.md"), "utf8")

    for (const phrase of [
      "Subagent delegation",
      "Structured questions",
      "context-mode",
      "pi-lens",
      "active-session",
      "matrix output",
      "Pass",
      "Degraded",
      "Fail",
    ]) {
      expect(grader).toContain(phrase)
    }
    expect(grader).toContain("empty diagnostics")
    expect(grader).toContain("zero matches")
    expect(grader).toContain("Safety gate")
  })
})
