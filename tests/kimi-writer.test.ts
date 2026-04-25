import { describe, expect, test } from "bun:test"
import { promises as fs } from "fs"
import path from "path"
import os from "os"
import { writeKimiBundle } from "../src/targets/kimi"
import type { KimiBundle } from "../src/types/kimi"

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

describe("writeKimiBundle", () => {
  test("writes agents, skills, AGENTS.md, and mcp.json", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kimi-test-"))
    const bundle: KimiBundle = {
      pluginName: "compound-engineering",
      generatedSkills: [
        {
          name: "gen-skill",
          content: "---\nname: gen-skill\n---\n\nGenerated skill body.",
        },
      ],
      agents: [
        {
          name: "security-reviewer",
          content: 'name: "security-reviewer"\ndescription: "Security"\nsystem_prompt: |\n  Review code.',
        },
      ],
      agentsMarkdown: "# Project Agents\n\n## security-reviewer\n\nReview code.",
      skillDirs: [
        {
          name: "skill-one",
          sourceDir: path.join(import.meta.dir, "fixtures", "sample-plugin", "skills", "skill-one"),
        },
      ],
      mcpServers: {
        playwright: { command: "npx", args: ["-y", "@anthropic/mcp-playwright"] },
      },
    }

    await writeKimiBundle(tempRoot, bundle)

    expect(await exists(path.join(tempRoot, ".kimi", "agents", "security-reviewer.yaml"))).toBe(true)
    expect(await exists(path.join(tempRoot, ".kimi", "skills", "gen-skill", "SKILL.md"))).toBe(true)
    expect(await exists(path.join(tempRoot, ".kimi", "skills", "skill-one", "SKILL.md"))).toBe(true)
    expect(await exists(path.join(tempRoot, ".kimi", "AGENTS.md"))).toBe(true)
    expect(await exists(path.join(tempRoot, ".kimi", "mcp.json"))).toBe(true)

    const agentContent = await fs.readFile(
      path.join(tempRoot, ".kimi", "agents", "security-reviewer.yaml"),
      "utf8",
    )
    expect(agentContent).toContain('name: "security-reviewer"')

    const skillContent = await fs.readFile(
      path.join(tempRoot, ".kimi", "skills", "gen-skill", "SKILL.md"),
      "utf8",
    )
    expect(skillContent).toContain("Generated skill body.")

    const agentsMdContent = await fs.readFile(path.join(tempRoot, ".kimi", "AGENTS.md"), "utf8")
    expect(agentsMdContent).toContain("# Project Agents")

    const mcpContent = JSON.parse(
      await fs.readFile(path.join(tempRoot, ".kimi", "mcp.json"), "utf8"),
    )
    expect(mcpContent.mcpServers.playwright.command).toBe("npx")
  })

  test("does not double-nest when output root is .kimi", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kimi-home-"))
    const kimiRoot = path.join(tempRoot, ".kimi")
    await fs.mkdir(kimiRoot, { recursive: true })

    const bundle: KimiBundle = {
      generatedSkills: [{ name: "skill", content: "Skill content" }],
      agents: [{ name: "reviewer", content: "Reviewer content" }],
      agentsMarkdown: "Agents MD",
      skillDirs: [],
      mcpServers: {},
    }

    await writeKimiBundle(kimiRoot, bundle)

    expect(await exists(path.join(kimiRoot, "agents", "reviewer.yaml"))).toBe(true)
    expect(await exists(path.join(kimiRoot, "skills", "skill", "SKILL.md"))).toBe(true)
    expect(await exists(path.join(kimiRoot, "AGENTS.md"))).toBe(true)
    // Should NOT double-nest under .kimi/.kimi
    expect(await exists(path.join(kimiRoot, ".kimi"))).toBe(false)
  })

  test("merges mcpServers into existing mcp.json", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kimi-merge-"))
    const kimiRoot = path.join(tempRoot, ".kimi")
    await fs.mkdir(kimiRoot, { recursive: true })

    // Write existing mcp.json
    const mcpPath = path.join(kimiRoot, "mcp.json")
    await fs.writeFile(mcpPath, JSON.stringify({
      mcpServers: { old: { command: "old-cmd" } },
    }))

    const bundle: KimiBundle = {
      generatedSkills: [],
      agents: [],
      agentsMarkdown: "",
      skillDirs: [],
      mcpServers: {
        newServer: { command: "new-cmd" },
      },
    }

    await writeKimiBundle(kimiRoot, bundle)

    const content = JSON.parse(await fs.readFile(mcpPath, "utf8"))
    expect(content.mcpServers.old.command).toBe("old-cmd")
    expect(content.mcpServers.newServer.command).toBe("new-cmd")
  })
})
