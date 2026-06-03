import { chmod, mkdir, mkdtemp, rm, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import { describe, expect, test } from "bun:test"

const checkHealthScript = path.join(
  import.meta.dir,
  "..",
  "..",
  "plugins",
  "compound-engineering",
  "skills",
  "ce-setup",
  "scripts",
  "check-health",
)

type RunResult = {
  exitCode: number
  stdout: string
  stderr: string
}

async function runCheckHealth(
  home: string,
  pathValue: string,
  args: string[] = [],
  cwd = home,
): Promise<RunResult> {
  const proc = Bun.spawn(["bash", checkHealthScript, ...args], {
    cwd,
    env: {
      ...process.env,
      HOME: home,
      PATH: pathValue,
    },
    stderr: "pipe",
    stdout: "pipe",
  })

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])

  return { exitCode, stdout, stderr }
}

async function writeExecutable(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content)
  await chmod(filePath, 0o755)
}

describe("ce-setup check-health", () => {
  test("reports Pi capabilities as blocked or degraded in an empty temp home", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ce-setup-pi-empty-"))

    try {
      const result = await runCheckHealth(root, "/usr/bin:/bin")

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain("Pi capabilities")
      expect(result.stdout).toContain("Root: ")
      expect(result.stdout).toContain("Subagent delegation: blocked")
      expect(result.stdout).toContain("Structured questions: degraded")
      expect(result.stdout).toContain("Large-output compression: degraded")
      expect(result.stdout).toContain("Symbol diagnostics/navigation: degraded")
      expect(result.stdout).toContain("CE artifact presence: missing")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("reports fake Pi package directories as active-or-unverified via --pi-home", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ce-setup-pi-packages-"))
    const piHome = path.join(root, "agent")

    try {
      for (const packageName of [
        "pi-subagents",
        "@juicesharp/rpiv-ask-user-question",
        "@juicesharp/rpiv-todo",
        "pi-web-access",
        "context-mode",
        "pi-lens",
      ]) {
        await mkdir(path.join(piHome, "npm", "node_modules", packageName), { recursive: true })
      }

      const result = await runCheckHealth(root, "/usr/bin:/bin", ["--pi-home", piHome])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain(`Root: ${piHome} (--pi-home)`)
      expect(result.stdout).toContain("Subagent delegation: active-or-unverified")
      expect(result.stdout).toContain("Structured questions: active-or-unverified")
      expect(result.stdout).toContain("Task tracking: active-or-unverified")
      expect(result.stdout).toContain("Web research: active-or-unverified")
      expect(result.stdout).toContain("Persistent/session recall: active-or-unverified")
      expect(result.stdout).toContain("Structural search/edit: active-or-unverified")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("does not let an explicit empty Pi root inherit default-home packages", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ce-setup-pi-explicit-empty-"))
    const explicitPiHome = path.join(root, "explicit-agent")

    try {
      await mkdir(path.join(root, ".pi", "agent", "npm", "node_modules", "pi-subagents"), { recursive: true })
      const result = await runCheckHealth(root, "/usr/bin:/bin", ["--pi-home", explicitPiHome])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain(`Root: ${explicitPiHome} (--pi-home)`)
      expect(result.stdout).toContain("Subagent delegation: blocked")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("reports converted CE artifact presence under an explicit Pi root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ce-setup-pi-artifacts-"))
    const piHome = path.join(root, ".pi")

    try {
      await mkdir(path.join(piHome, "skills", "ce-plan"), { recursive: true })
      await mkdir(path.join(piHome, "agents"), { recursive: true })
      await mkdir(path.join(piHome, "prompts"), { recursive: true })
      await mkdir(path.join(piHome, "compound-engineering"), { recursive: true })
      await writeFile(path.join(piHome, "agents", "ce-agent.md"), "agent")
      await writeFile(path.join(piHome, "prompts", "ce-plan.md"), "prompt")
      await writeFile(path.join(piHome, "compound-engineering", "install-manifest.json"), "{}")

      const result = await runCheckHealth(root, "/usr/bin:/bin", ["--pi-home", piHome])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain(`Root: ${piHome} (--pi-home)`)
      expect(result.stdout).toContain("CE artifact presence: installed")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("reports partial converted CE artifact state as degraded", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ce-setup-pi-partial-artifacts-"))
    const piHome = path.join(root, ".pi")

    try {
      await mkdir(path.join(piHome, "skills", "ce-plan"), { recursive: true })
      const result = await runCheckHealth(root, "/usr/bin:/bin", ["--pi-home", piHome])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain("CE artifact presence: degraded")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("does not count missing Pi delegation as a generic setup issue", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ce-setup-non-pi-all-clear-"))

    try {
      await mkdir(path.join(root, ".agents", "skills", "ast-grep"), { recursive: true })
      const binDir = path.join(root, "bin")
      for (const commandName of ["agent-browser", "gh", "jq", "vhs", "silicon", "ffmpeg", "ast-grep"]) {
        await writeExecutable(path.join(binDir, commandName), "#!/usr/bin/env bash\nexit 0\n")
      }
      await writeExecutable(
        path.join(binDir, "npx"),
        "#!/usr/bin/env bash\nprintf '%s\\n' '[{\"name\":\"ast-grep\"}]'\n",
      )

      const result = await runCheckHealth(root, `${binDir}:/usr/bin:/bin`)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain("Subagent delegation: blocked")
      expect(result.stdout).toContain("All clear  7/7 tools  1/1 skills")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("detects default ~/.pi/agent when running from a home directory that also contains .pi", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ce-setup-pi-home-agent-"))

    try {
      await mkdir(path.join(root, ".pi", "agent", "npm", "node_modules", "pi-subagents"), { recursive: true })
      const result = await runCheckHealth(root, "/usr/bin:/bin", [], root)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain(`Root: ${path.join(root, ".pi", "agent")} (default)`)
      expect(result.stdout).toContain("Subagent delegation: active-or-unverified")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("detects workspace .pi roots before the default home root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ce-setup-pi-workspace-"))
    const workspace = path.join(root, "workspace")
    const piHome = path.join(workspace, ".pi")

    try {
      await mkdir(path.join(piHome, "skills", "ce-plan"), { recursive: true })
      await mkdir(path.join(piHome, "agents"), { recursive: true })
      await mkdir(path.join(piHome, "compound-engineering"), { recursive: true })
      await writeFile(path.join(piHome, "compound-engineering", "install-manifest.json"), "{}")

      const result = await runCheckHealth(root, "/usr/bin:/bin", [], workspace)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain(`Root: ${piHome} (workspace)`)
      expect(result.stdout).toContain("CE artifact presence: installed")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("detects global Codex skills under ~/.agents/skills when skills CLI misses them", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ce-setup-health-"))

    try {
      await mkdir(path.join(root, ".agents", "skills", "ast-grep"), { recursive: true })

      const binDir = path.join(root, "bin")
      await writeExecutable(
        path.join(binDir, "npx"),
        "#!/usr/bin/env bash\nprintf '%s\\n' '[{\"name\":\"other-skill\"}]'\n",
      )

      const result = await runCheckHealth(root, `${binDir}:/usr/bin:/bin`)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain("Skills  1/1")
      expect(result.stdout).toContain("1/1 skills")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
