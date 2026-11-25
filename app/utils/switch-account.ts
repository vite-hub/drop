import { PROXY_SIGN_OUT_HANDOFF_HEADER } from "#shared/sign-in"

type SignOutError = { message?: string; status: number; code?: string }
type SwitchAccount = {
  signOut: (options: { fetchOptions: { headers: Record<string, string> } }) => Promise<{ error?: SignOutError | null }>
  navigate: (url: string) => unknown
}

export class SwitchSignOutError extends Error {
  constructor(cause: unknown) {
    super("Couldn't confirm sign-out. Try again.", { cause })
  }
}

export async function switchProxyAccount(start: string, { signOut, navigate }: SwitchAccount) {
  const { error } = await signOut({ fetchOptions: { headers: { [PROXY_SIGN_OUT_HANDOFF_HEADER]: "1" } } }).catch(
    (cause: unknown) => {
      throw new SwitchSignOutError(cause)
    },
  )
  if (error) throw new SwitchSignOutError(error)
  return navigate(`/oauth2/sign_out?rd=${encodeURIComponent(start)}`)
}
