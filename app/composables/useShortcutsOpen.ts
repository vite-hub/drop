/** Whether the ? dialog (ShortcutsModal) is open. Opened from ?, the account menu, or the ⌘K palette. */
export const useShortcutsOpen = () => useState("shortcuts-open", () => false)
