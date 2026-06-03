import { describe, expect, test } from "bun:test"
import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { loadClaudePlugin } from "../src/parsers/claude"
import { convertClaudeToPi } from "../src/converters/claude-to-pi"
import { writePiBundle } from "../src/targets/pi"

const repoRoot = path.join(import.meta.dir, "..")
const skillRoot = path.join(repoRoot, "plugins", "compound-engineering", "skills")

const coreSkillCapabilities: Record<string, string[]> = {
  "ce-brainstorm": ["large-output compression", "persistent/session recall", "web research", "blocking question tools"],
  "ce-plan": ["large-output compression", "persistent/session recall", "web research", "task tracking", "subagent delegation"],
  "ce-work": ["large-output compression", "symbol diagnostics/navigation", "structural search/edit", "task tracking", "subagent delegation", "web research"],
  "ce-work-beta": ["large-output compression", "symbol diagnostics/navigation", "structural search/edit", "task tracking", "subagent delegation", "web research"],
  "ce-debug": ["large-output compression", "symbol diagnostics/navigation", "structural search/edit", "web research"],
  "ce-code-review": ["large-output compression", "symbol diagnostics/navigation", "structural search/edit", "subagent delegation", "blocking question tools"],
  "ce-doc-review": ["large-output compression", "persistent/session recall", "subagent delegation", "blocking question tools"],
  "ce-simplify-code": ["symbol diagnostics/navigation", "structural search/edit"],
  "ce-sessions": ["large-output compression", "persistent/session recall"],
  "ce-compound": ["large-output compression", "persistent/session recall", "web research"],
  "ce-compound-refresh": ["large-output compression", "persistent/session recall", "structural search/edit"],
}

async function readSkill(skillName: string): Promise<string> {
  return fs.readFile(path.join(skillRoot, skillName, "SKILL.md"), "utf8")
}

async function readInstalledSkill(outputRoot: string, skillName: string): Promise<string> {
  return fs.readFile(path.join(outputRoot, "skills", skillName, "SKILL.md"), "utf8")
}

function extractToolingPreference(content: string): string {
  const match = content.match(/## Tooling Preference\n[\s\S]*?(?=\n## |\n# |$)/)
  if (!match) throw new Error("Missing ## Tooling Preference block")
  return match[0].trim()
}

describe("Pi tool guidance contract", () => {
  test("core skills describe capability-row tooling with fallback semantics", async () => {
    for (const [skillName, capabilities] of Object.entries(coreSkillCapabilities)) {
      const content = await readSkill(skillName)
      expect(content, skillName).toContain("## Tooling Preference")
      for (const capability of capabilities) {
        expect(content, `${skillName} should mention ${capability}`).toContain(capability)
      }
      expect(content, `${skillName} should define unavailable-tool fallback`).toContain("Unavailable tools and tool errors trigger fallback")
      expect(content, `${skillName} should treat empty results as data`).toContain("empty diagnostics, zero matches, and no recall results are data")
    }
  })

  test("converted Pi core skills name installed expert tools for discussed capabilities", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pi-tool-guidance-"))
    const outputRoot = path.join(tempRoot, ".pi")
    const plugin = await loadClaudePlugin(path.join(repoRoot, "plugins", "compound-engineering"))
    const bundle = convertClaudeToPi(plugin, {
      agentMode: "subagent",
      inferTemperature: true,
      permissions: "none",
    })

    await writePiBundle(outputRoot, bundle)

    for (const [skillName, capabilities] of Object.entries(coreSkillCapabilities)) {
      const installed = await readInstalledSkill(outputRoot, skillName)
      if (capabilities.includes("large-output compression") || capabilities.includes("persistent/session recall")) {
        expect(installed, `${skillName} should name context-mode`).toContain("context-mode")
      }
      if (capabilities.includes("large-output compression")) {
        expect(installed, `${skillName} should name ctx_execute`).toContain("ctx_execute")
      }
      if (capabilities.includes("persistent/session recall")) {
        expect(installed, `${skillName} should name ctx_search`).toContain("ctx_search")
        expect(installed, `${skillName} should name ctx_index`).toContain("ctx_index")
      }
      if (capabilities.includes("symbol diagnostics/navigation") || capabilities.includes("structural search/edit")) {
        expect(installed, `${skillName} should name pi-lens`).toContain("pi-lens")
      }
      if (capabilities.includes("symbol diagnostics/navigation")) {
        expect(installed, `${skillName} should name lsp_diagnostics`).toContain("lsp_diagnostics")
      }
      if (capabilities.includes("structural search/edit")) {
        expect(installed, `${skillName} should name ast_grep_search`).toContain("ast_grep_search")
      }
      if (capabilities.includes("task tracking")) {
        expect(installed, `${skillName} should name todo`).toContain("todo")
      }
      if (capabilities.includes("subagent delegation")) {
        expect(installed, `${skillName} should name subagent`).toContain("subagent")
      }
      if (capabilities.includes("web research")) {
        expect(installed, `${skillName} should name web_search`).toContain("web_search")
        expect(installed, `${skillName} should name fetch_content`).toContain("fetch_content")
      }
      if (capabilities.includes("blocking question tools")) {
        expect(installed, `${skillName} should name ask_user_question`).toContain("ask_user_question")
      }
    }
  })

  test("question-heavy skills preserve numbered-list fallback for Pi option limits", async () => {
    for (const skillName of ["ce-brainstorm", "ce-code-review", "ce-doc-review"]) {
      const content = await readSkill(skillName)
      expect(content, skillName).toContain("numbered-list fallback")
      expect(content, skillName).toMatch(/5(?:\+|-option| or more)/)
    }
  })

  test("ce-work and ce-work-beta keep shared tooling guidance synchronized", async () => {
    const stable = extractToolingPreference(await readSkill("ce-work"))
    const beta = extractToolingPreference(await readSkill("ce-work-beta"))
    expect(beta).toBe(stable)
  })

  test("Pi documentation matches current converter-backed install posture", async () => {
    const rootReadme = await fs.readFile(path.join(repoRoot, "README.md"), "utf8")
    const pluginReadme = await fs.readFile(path.join(repoRoot, "plugins", "compound-engineering", "README.md"), "utf8")
    const setupDoc = await fs.readFile(path.join(repoRoot, "docs", "skills", "ce-setup.md"), "utf8")
    const nativeStrategy = await fs.readFile(
      path.join(repoRoot, "docs", "solutions", "integrations", "native-plugin-install-strategy.md"),
      "utf8",
    )

    for (const content of [rootReadme, pluginReadme, setupDoc]) {
      expect(content).toContain("Pi capability")
    }
    expect(setupDoc).toContain("readiness signal, not a new install flow")
    expect(rootReadme).toContain("does not ship a bundled CE compat extension")
    expect(rootReadme).toContain("context-mode")
    expect(rootReadme).toContain("pi-lens")
    expect(nativeStrategy).toContain("~/.pi/agent/agents/<agent>.md")
    expect(nativeStrategy).toContain("rather than a bundled compat extension")
    expect(nativeStrategy).not.toContain("packaged the compat extension")
  })

  test("skill markdown does not reference files outside its own directory tree", async () => {
    const skillNames = Object.keys(coreSkillCapabilities)
    for (const skillName of skillNames) {
      const skillDir = path.join(skillRoot, skillName)
      const content = await fs.readFile(path.join(skillDir, "SKILL.md"), "utf8")
      expect(content, skillName).not.toMatch(/(?:^|[\s"'`])\.\.\//)
      expect(content, skillName).not.toMatch(/\/plugins\/compound-engineering\/skills\//)
      expect(content, skillName).not.toMatch(/~\/\.claude\/plugins\/cache\/.*\/skills\//)
    }
  })
})
