import { type ClaudeAgent, type ClaudeCommand, type ClaudeMcpServer, type ClaudePlugin, filterSkillsByPlatform } from "../types/claude"
import type { KimiAgent, KimiBundle, KimiMcpServer, KimiSkill } from "../types/kimi"
import type { ClaudeToOpenCodeOptions } from "./claude-to-opencode"
import { formatFrontmatter } from "../utils/frontmatter"

export type ClaudeToKimiOptions = ClaudeToOpenCodeOptions

export function convertClaudeToKimi(
  plugin: ClaudePlugin,
  _options: ClaudeToKimiOptions,
): KimiBundle {
  const usedNames = new Set<string>()

  // 1. Process Skill Directories (Pass-through)
  const platformSkills = filterSkillsByPlatform(plugin.skills, "kimi")
  const skillDirs = platformSkills.map((skill) => ({
    name: skill.name,
    sourceDir: skill.sourceDir,
  }))

  // 2. Convert Commands to Skills
  const generatedSkills: KimiSkill[] = plugin.commands.map((command) => {
    const name = normalizeName(command.name)
    const content = convertCommandToSkill(command)
    return { name, content }
  })

  // 3. Convert Agents to YAML and AGENTS.md
  const agents: KimiAgent[] = plugin.agents.map((agent) => {
    const name = uniqueName(normalizeName(agent.name), usedNames)
    const content = convertAgentToYaml(agent)
    return { name, content }
  })

  const agentsMarkdown = generateAgentsMarkdown(plugin.agents)

  // 4. Convert MCP Servers
  const mcpServers = convertMcpServers(plugin.mcpServers)

  return {
    pluginName: plugin.manifest.name,
    generatedSkills,
    skillDirs,
    agents,
    agentsMarkdown,
    mcpServers,
  }
}

function convertCommandToSkill(command: ClaudeCommand): string {
  const frontmatter: Record<string, unknown> = {
    name: command.name,
    description: command.description ?? `Command ${command.name}`,
  }

  let body = transformContentForKimi(command.body.trim())
  if (command.argumentHint) {
    body += `\n\nUser request: {{args}}`
  }

  return formatFrontmatter(frontmatter, body)
}

function convertAgentToYaml(agent: ClaudeAgent): string {
  const name = normalizeName(agent.name)
  const description = agent.description ?? `Agent ${agent.name}`
  const instructions = transformContentForKimi(agent.body.trim())

  // Kimi Agent YAML format
  const lines: string[] = []
  lines.push(`name: ${JSON.stringify(name)}`)
  lines.push(`description: ${JSON.stringify(description)}`)
  if (agent.capabilities && agent.capabilities.length > 0) {
    lines.push(`capabilities:`)
    for (const cap of agent.capabilities) {
      lines.push(`  - ${JSON.stringify(cap)}`)
    }
  }
  lines.push(`system_prompt: |`)
  const indentedBody = instructions.split("\n").map(line => `  ${line}`).join("\n")
  lines.push(indentedBody)

  return lines.join("\n")
}

function generateAgentsMarkdown(agents: ClaudeAgent[]): string {
  const lines: string[] = []
  lines.push(`# Project Agents`)
  lines.push(``)
  lines.push(`This project uses the following specialized agents to assist with engineering tasks.`)
  lines.push(``)

  for (const agent of agents) {
    lines.push(`## ${agent.name}`)
    if (agent.description) {
      lines.push(`${agent.description}`)
      lines.push(``)
    }
    if (agent.capabilities && agent.capabilities.length > 0) {
      lines.push(`### Capabilities`)
      for (const cap of agent.capabilities) {
        lines.push(`- ${cap}`)
      }
      lines.push(``)
    }
  }

  return lines.join("\n")
}

/**
 * Transform Claude Code content to Kimi-compatible content.
 *
 * 1. Task agent calls: Task agent-name(args) -> Use the @agent-name subagent to: args
 * 2. Path rewriting: .claude/ -> .kimi/, ~/.claude/ -> ~/.kimi/
 * 3. Agent references: @agent-name -> @agent-name
 */
export function transformContentForKimi(body: string): string {
  let result = body

  // 1. Transform Task agent calls
  const taskPattern = /^(\s*-?\s*)Task\s+([a-z][a-z0-9:-]*)\(([^)]*)\)/gm
  result = result.replace(taskPattern, (_match, prefix: string, agentName: string, args: string) => {
    const finalSegment = agentName.includes(":") ? agentName.split(":").pop()! : agentName
    const kimiAgentName = normalizeName(finalSegment)
    const trimmedArgs = args.trim()
    return trimmedArgs
      ? `${prefix}Use the @${kimiAgentName} subagent to: ${trimmedArgs}`
      : `${prefix}Use the @${kimiAgentName} subagent`
  })

  // 2. Rewrite .claude/ paths to .kimi/
  result = result
    .replace(/~\/\.claude\//g, "~/.kimi/")
    .replace(/\.claude\//g, ".kimi/")

  return result
}

function convertMcpServers(
  servers?: Record<string, ClaudeMcpServer>,
): Record<string, KimiMcpServer> {
  const result: Record<string, KimiMcpServer> = {}
  if (!servers) return result

  for (const [name, server] of Object.entries(servers)) {
    const entry: KimiMcpServer = {}
    if (server.command) {
      entry.command = server.command
      if (server.args && server.args.length > 0) entry.args = server.args
      if (server.env && Object.keys(server.env).length > 0) entry.env = server.env
    } else if (server.url) {
      entry.url = server.url
      if (server.headers && Object.keys(server.headers).length > 0) entry.headers = server.headers
    }
    result[name] = entry
  }
  return result
}

function normalizeName(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return "item"
  return trimmed
    .toLowerCase()
    .replace(/[\\/]+/g, "-")
    .replace(/[:\s]+/g, "-")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "item"
}

function uniqueName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  let index = 2
  while (used.has(`${base}-${index}`)) {
    index += 1
  }
  const name = `${base}-${index}`
  used.add(name)
  return name
}
