import type { TelemetryFormat } from "./telemetry-rpc.ts"

type TuiKeymapLayer = {
  mode?: string
  priority?: number
  commands?: readonly {
    id?: string
    title?: string
    group?: string
    palette?: true
    slash?: { name: string; arguments?: true }
    enabled?: boolean | (() => boolean)
    run(input?: string): void | false | Promise<void>
  }[]
  bindings?: readonly string[]
}

type TuiKeymap = {
  layer(input: () => TuiKeymapLayer): void
}

export type TelemetryCommandDependencies = {
  getSessionID(): string | undefined
  getReport(input: { sessionID: string; format: TelemetryFormat }): Promise<string>
  showReport(report: string, format: TelemetryFormat): Promise<void>
  notify(message: string): void
}

export type TelemetryTuiCommandContext = {
  keymap: TuiKeymap
  currentRoute(): unknown
  getReport(input: { sessionID: string; format: TelemetryFormat }): Promise<string>
  showReport(report: string, format: TelemetryFormat): Promise<void>
  notify(message: string): void
}

const routeSessionID = (route: unknown): string | undefined => {
  if (!route || typeof route !== "object") return undefined
  const sessionRoute = route as { type?: string; sessionID?: string }
  return sessionRoute.type === "session" ? sessionRoute.sessionID : undefined
}

export const runTelemetryCommand = async (
  argumentsText: string | undefined,
  dependencies: TelemetryCommandDependencies,
): Promise<void> => {
  const sessionID = dependencies.getSessionID()
  if (!sessionID) {
    dependencies.notify("Open a session before requesting session telemetry.")
    return
  }

  const argumentsList = argumentsText?.trim().split(/\s+/).filter(Boolean) ?? []
  const invalid = argumentsList.filter((argument) => argument !== "--json")
  if (invalid.length > 0 || argumentsList.filter((argument) => argument === "--json").length > 1) {
    dependencies.notify("Usage: /session-telemetry [--json]")
    return
  }
  const format: TelemetryFormat = argumentsList.includes("--json") ? "json" : "markdown"

  try {
    const report = await dependencies.getReport({ sessionID, format })
    await dependencies.showReport(report, format)
  } catch (error) {
    dependencies.notify(`Could not load session telemetry: ${String(error)}`)
  }
}

export const registerTelemetryTuiCommand = (context: TelemetryTuiCommandContext): void => {
  context.keymap.layer(() => ({
    mode: "global",
    priority: 50,
    commands: [{
      id: "laya.session-telemetry",
      title: "Show session telemetry",
      group: "Laya",
      palette: true,
      slash: { name: "session-telemetry", arguments: true },
      enabled: () => true,
      run: async (input: string | undefined) => runTelemetryCommand(input, {
        getSessionID: () => routeSessionID(context.currentRoute()),
        getReport: context.getReport,
        showReport: context.showReport,
        notify: context.notify,
      }),
    }],
    bindings: ["laya.session-telemetry"],
  } satisfies TuiKeymapLayer))
}
