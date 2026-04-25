import path from "path"
import { backupFile, copySkillDir, ensureDir, pathExists, readJson, sanitizePathName, writeJson, writeText } from "../utils/files"
import { transformContentForKimi } from "../converters/claude-to-kimi"
import type { KimiBundle } from "../types/kimi"
import type { TargetScope } from "./index"

export async function writeKimiBundle(
  outputRoot: string,
  bundle: KimiBundle,
  scope?: TargetScope
): Promise<void> {
  const paths = resolveKimiPaths(outputRoot, scope)
  await ensureDir(paths.kimiDir)

  // 1. Write generated skills (from commands)
  if (bundle.generatedSkills.length > 0) {
    for (const skill of bundle.generatedSkills) {
      const skillName = sanitizePathName(skill.name)
      const targetDir = path.join(paths.skillsDir, skillName)
      await ensureDir(targetDir)
      await writeText(path.join(targetDir, "SKILL.md"), skill.content + "\n")
    }
  }

  // 2. Copy skill directories (pass-through)
  if (bundle.skillDirs.length > 0) {
    for (const skill of bundle.skillDirs) {
      const skillName = sanitizePathName(skill.name)
      const targetDir = path.join(paths.skillsDir, skillName)
      await copySkillDir(skill.sourceDir, targetDir, transformContentForKimi)
    }
  }

  // 3. Write explicit agent configurations (.yaml)
  if (bundle.agents.length > 0) {
    await ensureDir(paths.agentsDir)
    for (const agent of bundle.agents) {
      const agentFile = `${sanitizePathName(agent.name)}.yaml`
      await writeText(path.join(paths.agentsDir, agentFile), agent.content + "\n")
    }
    console.log(`Note: Kimi CLI agents written to ${paths.agentsDir} require manual loading via --agent-file.`)
  }

  // 4. Write aggregated AGENTS.md
  if (bundle.agentsMarkdown) {
    await writeText(path.join(paths.kimiDir, "AGENTS.md"), bundle.agentsMarkdown + "\n")
  }

  // 5. Write MCP servers to mcp.json
  if (Object.keys(bundle.mcpServers).length > 0) {
    const mcpPath = path.join(paths.kimiDir, "mcp.json")
    const backupPath = await backupFile(mcpPath)
    if (backupPath) {
      console.log(`Backed up existing mcp.json to ${backupPath}`)
    }

    let existingConfig: Record<string, unknown> = {}
    if (await pathExists(mcpPath)) {
      try {
        existingConfig = await readJson<Record<string, unknown>>(mcpPath)
      } catch {
        console.warn("Warning: existing mcp.json could not be parsed and will be replaced.")
      }
    }

    const existingServers =
      existingConfig.mcpServers && typeof existingConfig.mcpServers === "object"
        ? (existingConfig.mcpServers as Record<string, unknown>)
        : {}
    const merged = { ...existingConfig, mcpServers: { ...existingServers, ...bundle.mcpServers } }
    await writeJson(mcpPath, merged)
  }
}

function resolveKimiPaths(outputRoot: string, scope?: TargetScope) {
  const base = path.basename(outputRoot)
  // Global layout: explicit scope="global", or a basename that matches .kimi roots.
  const isGlobal = scope === "global" || base === "kimi" || base === ".kimi"
  if (isGlobal) {
    return {
      kimiDir: outputRoot,
      skillsDir: path.join(outputRoot, "skills"),
      agentsDir: path.join(outputRoot, "agents"),
    }
  }
  return {
    kimiDir: path.join(outputRoot, ".kimi"),
    skillsDir: path.join(outputRoot, ".kimi", "skills"),
    agentsDir: path.join(outputRoot, ".kimi", "agents"),
  }
}
