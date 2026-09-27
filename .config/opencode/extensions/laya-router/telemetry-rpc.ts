export const SessionTelemetryRpc = {
  id: "laya-telemetry",
  methods: {
    get: {
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          format: { type: "string", enum: ["markdown", "json"] },
        },
        required: ["sessionID", "format"],
      },
      output: {
        type: "object",
        properties: { report: { type: "string" } },
        required: ["report"],
      },
    },
  },
  events: {},
} as const

export type TelemetryFormat = "markdown" | "json"
