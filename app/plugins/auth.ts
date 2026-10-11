import { oauthProviderClient } from "@better-auth/oauth-provider/client"
import { createAuthClient } from "vite-hub/auth/vue"

export default defineNuxtPlugin(() => ({
  provide: { auth: createAuthClient({ plugins: [oauthProviderClient()] }) },
}))
