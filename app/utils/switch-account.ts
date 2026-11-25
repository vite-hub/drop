import { PROXY_SIGN_OUT_HANDOFF_HEADER } from "../../shared/sign-in"

type SwitchAccount = {
  signOut: (options: {
    fetchOptions: { headers: Record<string, string> }
  }) => Promise<{ error?: { message?: string; status: number } | null }>
  navigate: (url: string) => unknown
}

export async function switchProxyAccount(start: string, { signOut, navigate }: SwitchAccount) {
  const { error } = await signOut({ fetchOptions: { headers: { [PROXY_SIGN_OUT_HANDOFF_HEADER]: "1" } } })
  if (error) throw Object.assign(new Error(error.message ?? "Couldn't sign out."), { status: error.status })
  return navigate(`/oauth2/sign_out?rd=${encodeURIComponent(start)}`)
}
