import { describe, expect, test } from "bun:test"
import { convertClaudeToKimi, transformContentForKimi } from "../src/converters/claude-to-kimi"
import { parseFrontmatter } from "../src/utils/frontmatter"
import type { ClaudePlugin } from "../src/types/claude"

const fixturePlugin: ClaudePlugin = {
  root: "/tmp/plugin",
  manifest: { name: "fixture", version: "1.0.0" },
  agents: [
    {
      name: "Security Reviewer",
      description: "Security-focused agent",
      capabilities: ["Threat modeling", "OWASP"],
      model: "claude-sonnet-4-20250514",
      body: "Focus on vulnerabilities.",
      sourcePath: "/tmp/plugin/agents/security-reviewer.md",
    },
  ],
  commands: [
    {
      name: "workflows:plan",
      description: "Planning command",
      argumentHint: "[FOCUS]",
      model: "inherit",
      allowedTools: ["Read"],
      body: "Plan the work.",
      sourcePath: "/tmp/plugin/commands/workflows/plan.md",
    },
  ],
  skills: [
    {
      name: "existing-skill",
      description: "Existing skill",
      sourceDir: "/tmp/plugin/skills/existing-skill",
      skillPath: "/tmp/plugin/skills/existing-skill/SKILL.md",
    },
  ],
  hooks: undefined,
  mcpServers: {
    local: { command: "echo", args: ["hello"] },
  },
}

describe("convertClaudeToKimi", () => {
  test("converts agents to Kimi YAML", () => {
    const bundle = convertClaudeToKimi(fixturePlugin, {
      agentMode: "subagent",
      inferTemperature: false,
      permissions: "none",
    })

    const agent = bundle.agents.find((a) => a.name === "security-reviewer")
    expect(agent).toBeDefined()
    expect(agent!.content).toContain('name: "security-reviewer"')
    expect(agent!.content).toContain('description: "Security-focused agent"')
    expect(agent!.content).toContain("system_prompt: |")
    expect(agent!.content).toContain("Focus on vulnerabilities.")
    expect(agent!.content).toContain("- \"Threat modeling\"")
  })

  test("converts commands to Kimi skills with SKILL.md content", () => {
    const bundle = convertClaudeToKimi(fixturePlugin, {
      agentMode: "subagent",
      inferTemperature: false,
      permissions: "none",
    })

    expect(bundle.generatedSkills).toHaveLength(1)
    const skill = bundle.generatedSkills[0]
    expect(skill.name).toBe("workflows-plan")
    const parsed = parseFrontmatter(skill.content)
    expect(parsed.data.name).toBe("workflows:plan")
    expect(parsed.data.description).toBe("Planning command")
    expect(parsed.body).toContain("Plan the work.")
    expect(parsed.body).toContain("{{args}}")
  })

  test("generates aggregated AGENTS.md content", () => {
    const bundle = convertClaudeToKimi(fixturePlugin, {
      agentMode: "subagent",
      inferTemperature: false,
      permissions: "none",
    })

    expect(bundle.agentsMarkdown).toContain("# Project Agents")
    expect(bundle.agentsMarkdown).toContain("## Security Reviewer")
    expect(bundle.agentsMarkdown).toContain("Security-focused agent")
    expect(bundle.agentsMarkdown).toContain("- Threat modeling")
  })

  test("skills pass through as directory references", () => {
    const bundle = convertClaudeToKimi(fixturePlugin, {
      agentMode: "subagent",
      inferTemperature: false,
      permissions: "none",
    })

    expect(bundle.skillDirs).toHaveLength(1)
    expect(bundle.skillDirs[0].name).toBe("existing-skill")
    expect(bundle.skillDirs[0].sourceDir).toBe("/tmp/plugin/skills/existing-skill")
  })

  test("MCP servers convert to Kimi-compatible config", () => {
    const bundle = convertClaudeToKimi(fixturePlugin, {
      agentMode: "subagent",
      inferTemperature: false,
      permissions: "none",
    })

    expect(bundle.mcpServers.local.command).toBe("echo")
    expect(bundle.mcpServers.local.args).toEqual(["hello"])
  })
})

describe("transformContentForKimi", () => {
  test("transforms .claude/ paths to .kimi/", () => {
    const result = transformContentForKimi("Read .claude/settings.json for config.")
    expect(result).toContain(".kimi/settings.json")
    expect(result).not.toContain(".claude/")
  })

  test("transforms ~/.claude/ paths to ~/.kimi/", () => {
    const result = transformContentForKimi("Check ~/.claude/config for settings.")
    expect(result).toContain("~/.kimi/config")
    expect(result).not.toContain("~/.claude/")
  })

  test("transforms Task agent(args) to Kimi subagent reference", () => {
    const input = `Run these:

- Task repo-research-analyst(feature_description)
- Task learnings-researcher(feature_description)

Task best-practices-researcher(topic)`

    const result = transformContentForKimi(input)
    expect(result).toContain("Use the @repo-research-analyst subagent to: feature_description")
    expect(result).toContain("Use the @learnings-researcher subagent to: feature_description")
    expect(result).toContain("Use the @best-practices-researcher subagent to: topic")
    expect(result).not.toContain("Task repo-research-analyst")
  })
})
