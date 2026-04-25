export type KimiSkill = {
  name: string
  content: string // Full SKILL.md
}

export type KimiSkillDir = {
  name: string
  sourceDir: string
}

export type KimiAgent = {
  name: string
  content: string // Full YAML content
}

export type KimiMcpServer = {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

export type KimiBundle = {
  pluginName?: string
  generatedSkills: KimiSkill[]
  skillDirs: KimiSkillDir[]
  agents: KimiAgent[]
  agentsMarkdown: string // Aggregated AGENTS.md content
  mcpServers: Record<string, KimiMcpServer>
}
