import { PROXY_SIGN_OUT_HANDOFF_HEADER } from "../../shared/sign-in"

type SignOutError = { message?: string; status: number; code?: string }
type SwitchAccount = {
  signOut: (options: { fetchOptions: { headers: Record<string, string> } }) => Promise<{ error?: SignOutError | null }>
  navigate: (url: string) => unknown
}

const STILL_SIGNED_IN = "Couldn't sign you out, so you're still signed in. Try again."

export async function switchProxyAccount(start: string, { signOut, navigate }: SwitchAccount) {
  const { error } = await signOut({ fetchOptions: { headers: { [PROXY_SIGN_OUT_HANDOFF_HEADER]: "1" } } }).catch(
    (cause: unknown) => {
      throw new Error(STILL_SIGNED_IN, { cause })
    },
  )
  if (error)
    throw Object.assign(new Error(STILL_SIGNED_IN, { cause: error }), {
      status: error.status,
      ...(error.code ? { code: error.code } : {}),
    })
  return navigate(`/oauth2/sign_out?rd=${encodeURIComponent(start)}`)
}
