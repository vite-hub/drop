type SwitchAccount = {
  signOut: () => Promise<{ error?: { message?: string; status: number } | null }>
  navigate: (url: string) => unknown
  failed: (cause: unknown) => void
}

export async function switchProxyAccount(start: string, { signOut, navigate, failed }: SwitchAccount) {
  try {
    const { error } = await signOut()
    if (error) failed(error)
  } catch (cause) {
    failed(cause)
  }
  return navigate(`/oauth2/sign_out?rd=${encodeURIComponent(start)}`)
}
