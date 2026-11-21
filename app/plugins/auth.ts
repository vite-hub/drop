import { oauthProviderClient } from "@better-auth/oauth-provider/client"
import { stripeClient } from "@better-auth/stripe/client"
import { organizationClient } from "better-auth/client/plugins"
import { createAuthClient } from "vite-hub/auth/vue"

export default defineNuxtPlugin(() => ({
  provide: {
    auth: createAuthClient({
      plugins: [oauthProviderClient(), organizationClient(), stripeClient({ subscription: true })],
    }),
  },
}))
