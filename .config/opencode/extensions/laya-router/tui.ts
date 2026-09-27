import { SessionTelemetryRpc } from "./telemetry-rpc.ts"
import { registerTelemetryTuiCommand } from "./tui-command.ts"
import { aggregateAssistantMessageUsage, augmentTelemetryReport, formatTelemetrySelectOptions, withNativeSessionTotals, type AssistantMessageRecord, type NativeSessionUsage, type TelemetrySelectOption } from "./telemetry.ts"

type TuiContext = {
  client: {
    rpc(definition: typeof SessionTelemetryRpc): {
      get(request: { sessionID: string; format: "markdown" | "json" }): Promise<unknown>
    }
  }
  keymap: Parameters<typeof registerTelemetryTuiCommand>[0]["keymap"]
  data: {
    session: {
      sync(sessionID: string): Promise<unknown>
      get(sessionID: string): NativeSessionUsage | undefined
      family(sessionID: string): string[]
      message: {
        sync(sessionID: string): Promise<unknown>
        list(sessionID: string): readonly AssistantMessageRecord[]
      }
    }
  }
  ui: {
    slot(input: { append: "app"; render(): null }): () => void
    router: { current(): unknown }
    dialog: {
      alert(options: { title: string; message: string }): Promise<void>
      select(options: { title: string; options: readonly TelemetrySelectOption[] }): Promise<unknown>
    }
    toast: { show(options: { message: string; variant: "info" }): void }
  }
}

export default {
  id: "laya-model-router.tui",
  setup(rawContext: TuiContext) {
    const telemetry = rawContext.client.rpc(SessionTelemetryRpc)
    rawContext.ui.slot({
      append: "app",
      render: () => {
        registerTelemetryTuiCommand({
          keymap: rawContext.keymap,
          currentRoute: () => rawContext.ui.router.current(),
          getReport: async (request: { sessionID: string; format: "markdown" | "json" }) => {
            const reportFormat = request.format === "markdown" ? "json" : request.format
            const result = await telemetry.get({ ...request, format: reportFormat })
            if (!result || typeof result !== "object" || !("report" in result) || typeof result.report !== "string") {
              throw new Error("Telemetry RPC returned an invalid report")
            }
            const sessionIDs = [...new Set([request.sessionID, ...rawContext.data.session.family(request.sessionID)])]
            const messages: AssistantMessageRecord[] = []
            const nativeUsage: NativeSessionUsage[] = []
            for (const sessionID of sessionIDs) {
              await rawContext.data.session.sync(sessionID)
              await rawContext.data.session.message.sync(sessionID)
              messages.push(...rawContext.data.session.message.list(sessionID))
              nativeUsage.push(rawContext.data.session.get(sessionID) ?? {})
            }
            const usage = withNativeSessionTotals(
              aggregateAssistantMessageUsage(messages),
              nativeUsage,
            )
            return augmentTelemetryReport(result.report, reportFormat, usage)
          },
          showReport: async (report, format) => {
            if (format === "json") {
              await rawContext.ui.dialog.alert({ title: "Session telemetry", message: report })
              return
            }
            await rawContext.ui.dialog.select({ title: "Session telemetry", options: formatTelemetrySelectOptions(report) })
          },
          notify: (message) => rawContext.ui.toast.show({ message, variant: "info" }),
        })
        return null
      },
    })
  },
}
