/**
 * Whether a newer build of Drop is deployed than the one this tab runs. The update-ready plugin sets it; the sidebar
 * shows Update ready, and Show sidebar a dot, until a reload.
 */
export const useUpdateReady = () => useState("update-ready", () => false)
