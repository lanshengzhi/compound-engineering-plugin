import { describe, expect, test } from "bun:test"
import path from "path"
import { loadClaudePlugin } from "../src/parsers/claude"
import { convertClaudeToPi, transformContentForPi } from "../src/converters/claude-to-pi"
import { parseFrontmatter } from "../src/utils/frontmatter"
import type { ClaudePlugin } from "../src/types/claude"

const fixtureRoot = path.join(import.meta.dir, "fixtures", "sample-plugin")

describe("convertClaudeToPi", () => {
  test("converts commands, skills, agents, and MCP servers without shipping a Pi extension", async () => {
    const plugin = await loadClaudePlugin(fixtureRoot)
    const bundle = convertClaudeToPi(plugin, {
      agentMode: "subagent",
      inferTemperature: false,
      permissions: "none",
    })

    // Prompts are normalized command names
    expect(bundle.prompts.some((prompt) => prompt.name === "workflows-review")).toBe(true)
    expect(bundle.prompts.some((prompt) => prompt.name === "plan_review")).toBe(true)

    // Commands with disable-model-invocation are excluded
    expect(bundle.prompts.some((prompt) => prompt.name === "deploy-docs")).toBe(false)

    const workflowsReview = bundle.prompts.find((prompt) => prompt.name === "workflows-review")
    expect(workflowsReview).toBeDefined()
    const parsedPrompt = parseFrontmatter(workflowsReview!.content)
    expect(parsedPrompt.data.description).toBe("Run a multi-agent review workflow")

    // Existing skills are copied as skill dirs; Claude agents are converted to
    // Pi agent files (under bundle.agents, written to .pi/agents/<name>.md) so
    // that nicobailon/pi-subagents' `subagent` tool can resolve them by name.
    expect(bundle.skillDirs.some((skill) => skill.name === "skill-one")).toBe(true)
    expect(bundle.agents.some((agent) => agent.name === "repo-research-analyst")).toBe(true)
    // Agents no longer leak into generatedSkills — that field is reserved for
    // commands-as-skills on other targets; Pi keeps it empty.
    expect(bundle.generatedSkills).toEqual([])

    // Pi installs now depend on community pi-subagents and ask_user_question extensions,
    // so the converter emits no bundled extension. Legacy cleanup in the Pi writer
    // removes any prior compound-engineering-compat.ts on upgrade.
    expect(bundle.extensions).toEqual([])

    // MCP servers declared in plugin.json are translated to Pi's mcporter.json
    // shape so plugins with MCP wiring keep their backends after conversion.
    // The fixture declares both an HTTP url server (context7) and a stdio
    // command server (local-tooling).
    expect(bundle.mcporterConfig).toEqual({
      mcpServers: {
        context7: {
          baseUrl: "https://mcp.context7.com/mcp",
          headers: undefined,
        },
        "local-tooling": {
          command: "echo",
          args: ["fixture"],
          env: undefined,
          headers: undefined,
        },
      },
    })
  })

  test("omits mcporterConfig when the plugin declares no MCP servers", () => {
    const plugin: ClaudePlugin = {
      root: "/tmp/plugin",
      manifest: { name: "fixture", version: "1.0.0" },
      agents: [],
      commands: [],
      skills: [],
      hooks: undefined,
      mcpServers: undefined,
    }

    const bundle = convertClaudeToPi(plugin, {
      agentMode: "subagent",
      inferTemperature: false,
      permissions: "none",
    })

    expect(bundle.mcporterConfig).toBeUndefined()
  })

  test("transforms Task calls, slash commands, todo references, and Pi ask-user tool names", () => {
    const plugin: ClaudePlugin = {
      root: "/tmp/plugin",
      manifest: { name: "fixture", version: "1.0.0" },
      agents: [],
      commands: [
        {
          name: "workflows:plan",
          description: "Plan workflow",
          body: [
            "Run these in order:",
            "- Task repo-research-analyst(feature_description)",
            "- Task learnings-researcher(feature_description)",
            "Use AskUserQuestion tool for follow-up.",
            "Then use /workflows:work and /prompts:todo-resolve.",
            "Track progress with TodoWrite and TodoRead.",
          ].join("\n"),
          sourcePath: "/tmp/plugin/commands/plan.md",
        },
      ],
      skills: [],
      hooks: undefined,
      mcpServers: undefined,
    }

    const bundle = convertClaudeToPi(plugin, {
      agentMode: "subagent",
      inferTemperature: false,
      permissions: "none",
    })

    expect(bundle.prompts).toHaveLength(1)
    const parsedPrompt = parseFrontmatter(bundle.prompts[0].content)

    expect(parsedPrompt.body).toContain("Run subagent with agent=\"repo-research-analyst\" and task=\"feature_description\".")
    expect(parsedPrompt.body).toContain("Run subagent with agent=\"learnings-researcher\" and task=\"feature_description\".")
    expect(parsedPrompt.body).toContain("ask_user_question tool")
    expect(parsedPrompt.body).not.toContain("AskUserQuestion tool")
    expect(parsedPrompt.body).toContain("/workflows-work")
    expect(parsedPrompt.body).toContain("/todo-resolve")
    expect(parsedPrompt.body).toContain("the platform's task-tracking primitive")
  })

  test("removes Claude ToolSearch question preload prose and normalizes legacy Pi ask-user wording", () => {
    const plugin: ClaudePlugin = {
      root: "/tmp/plugin",
      manifest: { name: "fixture", version: "1.0.0" },
      agents: [],
      commands: [
        {
          name: "question-flow",
          description: "Question flow",
          body: [
            "Use `AskUserQuestion` in Claude Code (call `ToolSearch` with `select:AskUserQuestion` first if its schema isn't loaded).",
            "In Claude Code, call `ToolSearch` with query `select:AskUserQuestion` before asking the question.",
            "Fallback triggers are unavailable tools — `ToolSearch` returns no match, the tool call explicitly fails, or the runtime mode does not expose it.",
            "Ask with `ask_user` in Pi (requires the `pi-ask-user` extension).",
          ].join("\n"),
          sourcePath: "/tmp/plugin/commands/question-flow.md",
        },
      ],
      skills: [],
      hooks: undefined,
      mcpServers: undefined,
    }

    const bundle = convertClaudeToPi(plugin, {
      agentMode: "subagent",
      inferTemperature: false,
      permissions: "none",
    })

    const parsedPrompt = parseFrontmatter(bundle.prompts[0].content)
    expect(parsedPrompt.body).toContain("`AskUserQuestion` in Claude Code")
    expect(parsedPrompt.body).toContain("`ask_user_question` in Pi")
    expect(parsedPrompt.body).toContain("`@juicesharp/rpiv-ask-user-question`")
    expect(parsedPrompt.body).not.toContain("ToolSearch")
    expect(parsedPrompt.body).not.toContain("select:AskUserQuestion")
    expect(parsedPrompt.body).not.toContain("pi-ask-user")
    expect(parsedPrompt.body).not.toContain("`ask_user` in Pi")
  })

  test("preserves ordinary slash paths and URLs while normalizing command names", () => {
    const body = [
      "Visit https://example.com/foo/bar?x=/keep and keep /tmp/example, /home/user/file, and /usr/local/bin intact.",
      "Then run /workflows:plan and /skill:CePlan.",
    ].join("\n")

    const transformed = transformContentForPi(body)

    expect(transformed).toContain("https://example.com/foo/bar?x=/keep")
    expect(transformed).toContain("/tmp/example")
    expect(transformed).toContain("/home/user/file")
    expect(transformed).toContain("/usr/local/bin")
    expect(transformed).toContain("/workflows-plan")
    expect(transformed).toContain("/skill:ceplan")
  })

  test("transforms current Claude Code Task* task-tracking primitives to platform-generic text", () => {
    const plugin: ClaudePlugin = {
      root: "/tmp/plugin",
      manifest: { name: "fixture", version: "1.0.0" },
      agents: [],
      commands: [
        {
          name: "workflows:work",
          description: "Work with task tracking",
          body: [
            "Plan tasks with TaskCreate and update their state with TaskUpdate.",
            "Inspect the list with TaskList. Fetch details with TaskGet.",
            "Stop long-running tasks with TaskStop and read output with TaskOutput.",
          ].join("\n"),
          sourcePath: "/tmp/plugin/commands/work.md",
        },
      ],
      skills: [],
      hooks: undefined,
      mcpServers: undefined,
    }

    const bundle = convertClaudeToPi(plugin, {
      agentMode: "subagent",
      inferTemperature: false,
      permissions: "none",
    })

    const parsedPrompt = parseFrontmatter(bundle.prompts[0].content)
    for (const token of ["TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskStop", "TaskOutput"]) {
      expect(parsedPrompt.body).not.toContain(token)
    }
    expect(parsedPrompt.body).toContain("the platform's task-tracking primitive")
  })

  test("transforms namespaced Task agent calls using final segment", () => {
    const plugin: ClaudePlugin = {
      root: "/tmp/plugin",
      manifest: { name: "fixture", version: "1.0.0" },
      agents: [],
      commands: [
        {
          name: "plan",
          description: "Planning with namespaced agents",
          body: [
            "Run agents:",
            "- Task compound-engineering:research:repo-research-analyst(feature_description)",
            "- Task compound-engineering:review:security-reviewer(code_diff)",
          ].join("\n"),
          sourcePath: "/tmp/plugin/commands/plan.md",
        },
      ],
      skills: [],
      hooks: undefined,
      mcpServers: undefined,
    }

    const bundle = convertClaudeToPi(plugin, {
      agentMode: "subagent",
      inferTemperature: false,
      permissions: "none",
    })

    const parsedPrompt = parseFrontmatter(bundle.prompts[0].content)
    expect(parsedPrompt.body).toContain('Run subagent with agent="repo-research-analyst" and task="feature_description".')
    expect(parsedPrompt.body).toContain('Run subagent with agent="security-reviewer" and task="code_diff".')
    expect(parsedPrompt.body).not.toContain("compound-engineering:")
  })

  test("transforms zero-argument Task calls", () => {
    const plugin: ClaudePlugin = {
      root: "/tmp/plugin",
      manifest: { name: "fixture", version: "1.0.0" },
      agents: [],
      commands: [
        {
          name: "review",
          description: "Review code",
          body: "- Task compound-engineering:review:code-simplicity-reviewer()",
          sourcePath: "/tmp/plugin/commands/review.md",
        },
      ],
      skills: [],
      hooks: undefined,
      mcpServers: undefined,
    }

    const bundle = convertClaudeToPi(plugin, {
      agentMode: "subagent",
      inferTemperature: false,
      permissions: "none",
    })

    const parsedPrompt = parseFrontmatter(bundle.prompts[0].content)
    expect(parsedPrompt.body).toContain('Run subagent with agent="code-simplicity-reviewer".')
    expect(parsedPrompt.body).not.toContain("compound-engineering:")
    expect(parsedPrompt.body).not.toContain("()")
  })

  test("maps Claude agent tool names to Pi tools and injects compatibility guidance", () => {
    const plugin: ClaudePlugin = {
      root: "/tmp/plugin",
      manifest: { name: "fixture", version: "1.0.0" },
      agents: [
        {
          name: "researcher",
          description: "Research things",
          tools: ["Read", "Grep", "Glob", "Bash", "WebFetch", "WebSearch", "AskUserQuestion", "TodoWrite", "Task", "mcp__context7__*"],
          body: "Use AskUserQuestion tool, then Task repo-research-analyst(topic).",
          sourcePath: "/tmp/plugin/agents/researcher.md",
        },
      ],
      commands: [],
      skills: [],
      hooks: undefined,
      mcpServers: undefined,
    }

    const bundle = convertClaudeToPi(plugin, {
      agentMode: "subagent",
      inferTemperature: false,
      permissions: "none",
    })

    const parsedAgent = parseFrontmatter(bundle.agents[0].content)
    expect(parsedAgent.data.tools).toBe("read, grep, find, bash, fetch_content, web_search, ask_user_question, todo, subagent")
    expect(parsedAgent.body).toContain("## Pi tool compatibility")
    expect(parsedAgent.body).toContain("WebSearch -> web_search")
    expect(parsedAgent.body).toContain("AskUserQuestion -> ask_user_question")
    expect(parsedAgent.body).not.toContain("mcp__context7__")
    expect(parsedAgent.body).not.toContain("pi-lens")
    expect(parsedAgent.body).not.toContain("context-mode")
    expect(parsedAgent.body).toContain("Use ask_user_question tool")
  })

  test("preserves Pi expert accelerator tools and scopes compatibility guidance to exposed tools", () => {
    const plugin: ClaudePlugin = {
      root: "/tmp/plugin",
      manifest: { name: "fixture", version: "1.0.0" },
      agents: [
        {
          name: "pi-expert",
          description: "Use optional Pi tooling",
          tools: [
            "Read",
            "Bash",
            "ctx_batch_execute",
            "ctx_execute",
            "ctx_execute_file",
            "ctx_fetch_and_index",
            "ctx_search",
            "ctx_index",
            "lsp_diagnostics",
            "lsp_navigation",
            "ast_grep_search",
            "ast_grep_replace",
          ],
          body: "Use context-mode and pi-lens when their tools are available; fall back to native tools on errors.",
          sourcePath: "/tmp/plugin/agents/pi-expert.md",
        },
      ],
      commands: [],
      skills: [],
      hooks: undefined,
      mcpServers: undefined,
    }

    const bundle = convertClaudeToPi(plugin, {
      agentMode: "subagent",
      inferTemperature: false,
      permissions: "none",
    })

    const parsedAgent = parseFrontmatter(bundle.agents[0].content)
    expect(parsedAgent.data.tools).toBe([
      "read",
      "bash",
      "ctx_batch_execute",
      "ctx_execute",
      "ctx_execute_file",
      "ctx_fetch_and_index",
      "ctx_search",
      "ctx_index",
      "lsp_diagnostics",
      "lsp_navigation",
      "ast_grep_search",
      "ast_grep_replace",
    ].join(", "))
    expect(parsedAgent.body).toContain("context-mode tools")
    expect(parsedAgent.body).toContain("pi-lens tools")
    expect(parsedAgent.body).toContain("ctx_fetch_and_index")
    expect(parsedAgent.body).toContain("lsp_diagnostics")
    expect(parsedAgent.body).toContain("ast_grep_search")
  })

})
