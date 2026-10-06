/** Toasts with one voice: successes are neutral, failures are red and carry the server's own sentence. */
export function useNotify() {
  const toast = useToast()
  return {
    done: (title: string, description?: string) => toast.add({ title, description, icon: "i-lucide-check" }),
    fail: (title: string, error: unknown) => toast.add({ title, description: errorText(error), color: "error", icon: "i-lucide-circle-alert" }),
    info: toast.add,
  }
}
