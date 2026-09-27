import { execFile } from "node:child_process"
import { promisify } from "node:util"

// RTK OpenCode plugin — rewrites commands to use rtk for token savings.
// Requires: rtk >= 0.23.0 in PATH.
//
// This is a thin delegating plugin: all rewrite logic lives in `rtk rewrite`,
// which is the single source of truth (src/discover/registry.rs).
// To add or change rewrite rules, edit the Rust registry — not this file.

const execFileAsync = promisify(execFile)

type ExecuteBeforeEvent = {
  tool: string
  input: unknown
}

type RtkPluginContext = {
  tool: {
    hook(name: "execute.before", handler: (event: ExecuteBeforeEvent) => Promise<void>): void
  }
}

export const RtkOpenCodePlugin = {
  id: "rtk-command-rewriter",
  async setup(ctx: RtkPluginContext) {
    try {
      await execFileAsync("rtk", ["--version"])
    } catch {
      console.warn("[rtk] rtk binary not found in PATH — plugin disabled")
      return
    }

    ctx.tool.hook("execute.before", async (event: ExecuteBeforeEvent) => {
      const tool = event.tool.toLowerCase()
      if (tool !== "bash" && tool !== "shell") return
      if (!event.input || typeof event.input !== "object") return

      const input = event.input as { command?: unknown }
      const command = input.command
      if (typeof command !== "string" || !command) return

      try {
        const { stdout } = await execFileAsync("rtk", ["rewrite", command])
        const rewritten = stdout.trim()
        if (rewritten && rewritten !== command) input.command = rewritten
      } catch {
        // rtk rewrite failed — pass through unchanged
      }
    })
  },
}

export default RtkOpenCodePlugin
