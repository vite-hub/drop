export const UI_CONTROLS = [
  "home",
  "comments",
  "list",
  "pins",
  "style-card",
  "style-pin",
  "page",
  "area",
  "copy-prompt",
  "mark",
  "measure",
  "rulers",
  "xray",
  "device",
  "present",
  "share",
  "more",
  "details",
  "width",
  "edit",
  "zen",
  "pin",
  "markdown",
  "download",
  "window",
  "report",
  "trash",
] as const
export type UiControl = (typeof UI_CONTROLS)[number]

export const UI_VIAS = ["shown", "click", "key", "palette"] as const
export type UiVia = (typeof UI_VIAS)[number]

export const UI_MODES = ["browse", "comment"] as const
export type UiMode = (typeof UI_MODES)[number]

export const MAX_USAGE_COUNTS = 200

// SAFETY: widening the tuple to read-only strings only lets `includes` take any string.
export const isUiControl = (value: unknown): value is UiControl =>
  typeof value === "string" && (UI_CONTROLS as readonly string[]).includes(value)

export const KEY_CONTROLS: Partial<Record<string, UiControl>> = {
  c: "comments",
  r: "area",
  s: "measure",
  u: "rulers",
  x: "xray",
  b: "mark",
  p: "mark",
  a: "mark",
  t: "mark",
  e: "edit",
  i: "more",
  h: "details",
  w: "width",
  m: "markdown",
  d: "download",
  z: "zen",
}
