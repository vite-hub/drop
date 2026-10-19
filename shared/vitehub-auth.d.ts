// ViteHub hands defineAuth's resolver the server env (useServerEnv), so it gets that env's types.
import type { ServerEnv } from "#vitehub/env/server"

declare global {
  namespace ViteHub {
    interface AuthRuntimeEnv extends ServerEnv {}
  }
}
