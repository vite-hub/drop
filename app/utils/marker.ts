/** The Marker's tips, as the review dock shows them (ViewerMarkTools): each one's key and its four sizes, in pixels. */
export const MARK_TIPS = {
  marker: { label: "Marker", key: "B", icon: "i-mingcute-mark-pen-line", sizes: [8, 14, 22, 32] },
  pen: { label: "Pen", key: "P", icon: "i-mingcute-pen-2-line", sizes: [2, 3, 5, 8] },
  arrow: { label: "Arrow", key: "A", icon: "i-mingcute-arrow-right-up-line", sizes: [2, 3, 5, 8] },
} as const
export type MarkTip = keyof typeof MARK_TIPS

export const MARK_COLORS = { pink: "#ec4899", amber: "#f59e0b", blue: "#2563eb", green: "#16a34a" } as const
export type MarkColor = keyof typeof MARK_COLORS

/** The tip in hand, its colour, and the size each tip was left at. */
export type MarkPen = { tip: MarkTip; color: MarkColor; sizes: Record<MarkTip, number> }
