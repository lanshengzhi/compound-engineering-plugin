import { formatFrontmatter } from "../utils/frontmatter"
import { type ClaudeAgent, type ClaudeCommand, type ClaudeMcpServer, type ClaudePlugin, filterSkillsByPlatform } from "../types/claude"
import type {
  PiBundle,
  PiGeneratedAgent,
  PiMcporterConfig,
  PiMcporterServer,
} from "../types/pi"
import type { ClaudeToOpenCodeOptions } from "./claude-to-opencode"

export type ClaudeToPiOptions = ClaudeToOpenCodeOptions

const PI_DESCRIPTION_MAX_LENGTH = 1024

export function convertClaudeToPi(
  plugin: ClaudePlugin,
  _options: ClaudeToPiOptions,
): PiBundle {
  const platformSkills = filterSkillsByPlatform(plugin.skills, "pi")
  const promptNames = new Set<string>()
  // Pi agents and skills live in separate directories (.pi/agents/<name>.md vs
  // .pi/skills/<name>/SKILL.md), so their names don't need to be deduplicated
  // against each other — nicobailon/pi-subagents resolves agents by filename
  // match and ignores skill dirs.
  const usedAgentNames = new Set<string>()

  const prompts = plugin.commands
    .filter((command) => !command.disableModelInvocation)
    .map((command) => convertPrompt(command, promptNames))

  const agents = plugin.agents.map((agent) => convertAgent(agent, usedAgentNames))

  return {
    pluginName: plugin.manifest.name,
    prompts,
    skillDirs: platformSkills.map((skill) => ({
      name: skill.name,
      sourceDir: skill.sourceDir,
    })),
    generatedSkills: [],
    agents,
    extensions: [],
    mcporterConfig: plugin.mcpServers ? convertMcpToMcporter(plugin.mcpServers) : undefined,
  }
}

function convertMcpToMcporter(servers: Record<string, ClaudeMcpServer>): PiMcporterConfig {
  const mcpServers: Record<string, PiMcporterServer> = {}

  for (const [name, server] of Object.entries(servers)) {
    if (server.command) {
      mcpServers[name] = {
        command: server.command,
        args: server.args,
        env: server.env,
        headers: server.headers,
      }
      continue
    }

    if (server.url) {
      mcpServers[name] = {
        baseUrl: server.url,
        headers: server.headers,
      }
    }
  }

  return { mcpServers }
}

function convertPrompt(command: ClaudeCommand, usedNames: Set<string>) {
  const name = uniqueName(normalizeName(command.name), usedNames)
  const frontmatter: Record<string, unknown> = {
    description: command.description,
    "argument-hint": command.argumentHint,
  }

  const body = transformContentForPi(command.body)

  return {
    name,
    content: formatFrontmatter(frontmatter, body.trim()),
  }
}

function convertAgent(agent: ClaudeAgent, usedNames: Set<string>): PiGeneratedAgent {
  const name = uniqueName(normalizeName(agent.name), usedNames)
  const description = sanitizeDescription(
    agent.description ?? `Converted from Claude agent ${agent.name}`,
  )
  const tools = mapClaudeToolsForPi(agent.tools)

  const frontmatter: Record<string, unknown> = {
    name,
    description,
    tools: tools?.join(", "),
  }

  const sections: string[] = [buildPiToolCompatibilityNote(tools)]
  if (agent.capabilities && agent.capabilities.length > 0) {
    sections.push(`## Capabilities\n${agent.capabilities.map((capability) => `- ${capability}`).join("\n")}`)
  }

  const body = [
    ...sections,
    agent.body.trim().length > 0
      ? transformContentForPi(agent.body.trim())
      : `Instructions converted from the ${agent.name} agent.`,
  ].join("\n\n")

  return {
    name,
    content: formatFrontmatter(frontmatter, body),
  }
}

export function transformContentForPi(body: string): string {
  let result = body

  // Pi's maintained structured-question extension exposes ask_user_question.
  // Older CE Pi output mentioned the legacy ask_user tool and pi-ask-user package;
  // normalize copied skill/reference prose to the installed tool name while keeping
  // the plain-chat fallback when the tool is unavailable.
  result = result.replace(
    /On platforms whose blocking question tool has no option cap \(Codex `request_user_input`, Pi `ask_user`\), use the platform's blocking tool;/g,
    "On platforms whose blocking question tool has no option cap (Codex `request_user_input`), use the platform's blocking tool. In Pi, `ask_user_question` has a 4-option cap, so use the numbered-list fallback for 5-option menus;",
  )
  result = result.replace(
    /On platforms where blocking question tools have no option cap \(e\.g\., Codex `request_user_input`, Pi `ask_user`\), use the platform's blocking tool with all 5 options\./g,
    "On platforms where blocking question tools have no option cap (e.g., Codex `request_user_input`), use the platform's blocking tool with all 5 options. In Pi, `ask_user_question` has a 4-option cap, so use the numbered-list fallback for 5-option menus.",
  )
  result = result.replace(
    /`AskUserQuestion` in Claude Code with `ToolSearch select:AskUserQuestion` pre-loaded if needed/g,
    "`AskUserQuestion` in Claude Code",
  )
  result = result.replace(
    /`AskUserQuestion` in Claude Code \(call `ToolSearch` with `select:AskUserQuestion` first if its schema isn't loaded\)/g,
    "`AskUserQuestion` in Claude Code",
  )
  result = result.replace(
    /`AskUserQuestion` in Claude Code — call `ToolSearch` with `select:AskUserQuestion` first if its schema isn't loaded/g,
    "`AskUserQuestion` in Claude Code",
  )
  result = result.replace(
    /In Claude Code[\s\S]*?call `ToolSearch` with (?:query )?`?select:AskUserQuestion`?[^.]*\.\s*/g,
    "",
  )
  result = result.replace(
    / — `ToolSearch` returns no match, the tool call explicitly fails, or the runtime mode does not expose it/g,
    ", the tool call explicitly fails, or the runtime mode does not expose it",
  )
  result = result.replace(
    /\s*\*\*Claude Code only:\*\*[^.]*call `ToolSearch` with query `select:AskUserQuestion`[^.]*\./g,
    "",
  )
  result = result.replace(/\s*A pending schema load is not a fallback trigger\./g, "")
  result = result.replace(/\s*A pending schema load is not a fallback trigger; call `ToolSearch` first per the pre-load rule\./g, "")
  result = result.replace(/ — not because a schema load is required/g, "")
  result = result.replace(
    /Only when `ToolSearch` explicitly returns no match or the tool call errors — or on a platform with no blocking question tool — fall back/g,
    "Only when the blocking question tool is unavailable or the tool call errors, fall back",
  )
  result = result.replace(
    /The numbered-list text fallback applies when `ToolSearch` explicitly returns no match for the platform's question tool or the tool call errors/g,
    "The numbered-list text fallback applies when the blocking question tool is unavailable or the tool call errors",
  )
  result = result.replace(
    /The numbered-list text fallback applies when `ToolSearch` explicitly returns no match or the tool call errors/g,
    "The numbered-list text fallback applies when the blocking question tool is unavailable or the tool call errors",
  )
  result = result.replace(
    /Numbered-list fallback applies when `ToolSearch` explicitly returns no match or the tool call errors/g,
    "Numbered-list fallback applies when the blocking question tool is unavailable or the tool call errors",
  )
  result = result.replace(
    /On Codex, Gemini, and Pi this checklist does not apply — there is no `ToolSearch` preload step to perform\.\s*/g,
    "On Codex, Gemini, and Pi this checklist does not apply. ",
  )
  result = result.replace(/`ToolSearch`/g, "the blocking question tool")
  result = result.replace(/\bToolSearch\b/g, "the blocking question tool")
  result = result.replace(
    /`ask_user` in Pi \(requires the `pi-ask-user` extension\)/g,
    "`ask_user_question` in Pi (provided by `@juicesharp/rpiv-ask-user-question`)",
  )
  result = result.replace(/Pi `ask_user`/g, "Pi `ask_user_question`")
  result = result.replace(/`ask_user` in Pi/g, "`ask_user_question` in Pi")
  result = result.replace(/`pi-ask-user`/g, "`@juicesharp/rpiv-ask-user-question`")
  result = result.replace(/\bpi-ask-user\b/g, "@juicesharp/rpiv-ask-user-question")
  result = result.replace(/`AskUserQuestion` tool/g, "`ask_user_question` tool")
  result = result.replace(/\bAskUserQuestion tool\b/g, "ask_user_question tool")
  result = result.replace(/\bAskUserQuestion$/gm, "ask_user_question")

  // Task repo-research-analyst(feature_description) or Task compound-engineering:research:repo-research-analyst(args)
  // -> Run subagent with agent="repo-research-analyst" and task="feature_description"
  const taskPattern = /^(\s*-?\s*)Task\s+([a-z][a-z0-9:-]*)\(([^)]*)\)/gm
  result = result.replace(taskPattern, (_match, prefix: string, agentName: string, args: string) => {
    const finalSegment = agentName.includes(":") ? agentName.split(":").pop()! : agentName
    const skillName = normalizeName(finalSegment)
    const trimmedArgs = args.trim().replace(/\s+/g, " ")
    return trimmedArgs
      ? `${prefix}Run subagent with agent="${skillName}" and task="${trimmedArgs}".`
      : `${prefix}Run subagent with agent="${skillName}".`
  })

  // Claude Code task-tracking primitives: current Task* API (TaskCreate/TaskUpdate/TaskList/TaskGet/TaskStop/TaskOutput)
  // plus the deprecated legacy pair (TodoWrite/TodoRead). All map to the platform's task-tracking primitive.
  result = result.replace(
    /\bTask(?:Create|Update|List|Get|Stop|Output)\b/g,
    "the platform's task-tracking primitive",
  )
  result = result.replace(/\bTodoWrite\b/g, "the platform's task-tracking primitive")
  result = result.replace(/\bTodoRead\b/g, "the platform's task-tracking primitive")

  // /command-name or /workflows:command-name -> /workflows-command-name
  const slashCommandPattern = /(?<![:\w])\/([a-z][a-z0-9_:-]*?)(?=[\s,."')\]}`]|$)/gi
  result = result.replace(slashCommandPattern, (match, commandName: string) => {
    if (commandName.includes("/")) return match
    if (["dev", "tmp", "etc", "usr", "var", "bin", "home"].includes(commandName)) {
      return match
    }

    if (commandName.startsWith("skill:")) {
      const skillName = commandName.slice("skill:".length)
      return `/skill:${normalizeName(skillName)}`
    }

    const withoutPrefix = commandName.startsWith("prompts:")
      ? commandName.slice("prompts:".length)
      : commandName

    return `/${normalizeName(withoutPrefix)}`
  })

  return result
}

function buildPiToolCompatibilityNote(exposedTools: string[] | undefined): string {
  const exposed = new Set(exposedTools ?? [])
  const lines = [
    "## Pi tool compatibility",
    "When these instructions mention Claude Code tool names, use the Pi equivalent:",
    "- Read -> read; Bash -> bash; Edit -> edit; Write -> write",
    "- Grep -> grep; Glob -> find; LS -> ls",
    "- WebSearch -> web_search and WebFetch -> fetch_content when `pi-web-access` is installed; otherwise proceed from local evidence and state missing external context",
    "- AskUserQuestion -> ask_user_question when `@juicesharp/rpiv-ask-user-question` is installed",
    "- Claude task-tracking primitives -> todo when `@juicesharp/rpiv-todo` is installed; otherwise keep task state in the platform task tracker or a TODO.md file",
    "- Task agent dispatch -> subagent when `pi-subagents` is installed",
  ]

  if (CONTEXT_MODE_TOOLS.some((tool) => exposed.has(tool))) {
    lines.push(
      "- Large-output compression, indexed web docs, and persistent recall -> context-mode tools (`ctx_batch_execute`, `ctx_execute`, `ctx_execute_file`, `ctx_fetch_and_index`, `ctx_search`, `ctx_index`) when `context-mode` is installed; otherwise use bounded native reads and shell summaries",
    )
  }

  if (PI_LENS_TOOLS.some((tool) => exposed.has(tool))) {
    lines.push(
      "- Symbol diagnostics/navigation and structural search/edit -> pi-lens tools (`lsp_diagnostics`, `lsp_navigation`, `ast_grep_search`, `ast_grep_replace`) when `pi-lens` is installed; otherwise use targeted source reads and native search/edit",
    )
  }

  return lines.join("\n")
}

const CONTEXT_MODE_TOOLS = [
  "ctx_batch_execute",
  "ctx_execute",
  "ctx_execute_file",
  "ctx_fetch_and_index",
  "ctx_search",
  "ctx_index",
]

const PI_LENS_TOOLS = [
  "lsp_diagnostics",
  "lsp_navigation",
  "ast_grep_search",
  "ast_grep_replace",
]

function mapClaudeToolsForPi(tools: string[] | undefined): string[] | undefined {
  const mapped: string[] = []
  const seen = new Set<string>()

  for (const tool of tools ?? []) {
    for (const piTool of mapClaudeToolForPi(tool)) {
      if (seen.has(piTool)) continue
      seen.add(piTool)
      mapped.push(piTool)
    }
  }

  return mapped.length > 0 ? mapped : undefined
}

function mapClaudeToolForPi(tool: string): string[] {
  const raw = tool.trim()
  if (!raw) return []
  if (raw.startsWith("mcp__") || raw.startsWith("mcp:")) return []

  const base = raw.replace(/\(.*/, "").trim()
  const lower = base.toLowerCase()

  switch (lower) {
    case "read":
    case "bash":
    case "edit":
    case "write":
    case "grep":
    case "find":
    case "ls":
    case "subagent":
    case "todo":
    case "web_search":
    case "fetch_content":
    case "code_search":
    case "get_search_content":
    case "ask_user_question":
    case "ctx_batch_execute":
    case "ctx_execute":
    case "ctx_execute_file":
    case "ctx_fetch_and_index":
    case "ctx_search":
    case "ctx_index":
    case "lsp_diagnostics":
    case "lsp_navigation":
    case "ast_grep_search":
    case "ast_grep_replace":
      return [lower]
    case "glob":
      return ["find"]
    case "websearch":
      return ["web_search"]
    case "webfetch":
      return ["fetch_content"]
    case "askuserquestion":
      return ["ask_user_question"]
    case "todoread":
    case "todowrite":
    case "taskcreate":
    case "taskupdate":
    case "tasklist":
    case "taskget":
    case "taskstop":
    case "taskoutput":
      return ["todo"]
    case "task":
      return ["subagent"]
    default:
      return []
  }
}

function normalizeName(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return "item"
  const normalized = trimmed
    .toLowerCase()
    .replace(/[\\/]+/g, "-")
    .replace(/[:\s]+/g, "-")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
  return normalized || "item"
}

function sanitizeDescription(value: string, maxLength = PI_DESCRIPTION_MAX_LENGTH): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) return normalized
  const ellipsis = "..."
  return normalized.slice(0, Math.max(0, maxLength - ellipsis.length)).trimEnd() + ellipsis
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
