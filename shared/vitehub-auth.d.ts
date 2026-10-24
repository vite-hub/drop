// ViteHub hands defineAuth's resolver the server env (useServerEnv), so it gets that env's types. ViteHub generates this
// same augmentation in .vitehub/types/auth.d.ts, but Nuxt's shared tsconfig doesn't include it, and shared code reaches
// server/auth.ts through type imports.
import type { ServerEnv } from "#vitehub/env/server"

declare global {
  namespace ViteHub {
    interface AuthRuntimeEnv extends ServerEnv {}
  }
}
