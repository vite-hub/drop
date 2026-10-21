import { oauthProviderClient } from "@better-auth/oauth-provider/client"
import { stripeClient } from "@better-auth/stripe/client"
import { organizationClient } from "better-auth/client/plugins"
import { createAuthClient } from "vite-hub/auth/vue"

// Teams and their billing only answer on a Drop with DROP_TEAMS and Stripe set up (server/utils/teams.ts).
export default defineNuxtPlugin(() => ({
  provide: {
    auth: createAuthClient({
      plugins: [oauthProviderClient(), organizationClient(), stripeClient({ subscription: true })],
    }),
  },
}))
