import type { NitroModule } from "nitro/types"

export const legacyViteHubRoutes: NitroModule["setup"] = ({ options }) => {
  for (const [current, legacy] of [
    ["/_vitehub/comments/**", "/api/_vitehub/comments/attachments/**"],
    ["/_vitehub/realtime/**", "/api/_vitehub/realtime/presence/:room"],
  ] as const) {
    const handler = options.handlers.find((entry) => entry.route === current)
    if (handler) options.handlers.push({ ...handler, route: legacy, method: "GET" })
  }
}
