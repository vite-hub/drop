/** The sizes the review toolbar's Device menu offers, in CSS pixels, the way each usually stands. A phone, a tablet, a laptop, a desktop. */
type Preset = "iphone" | "ipad" | "laptop" | "desktop"
export const DEVICES: { id: Preset; label: string; icon: string; width: number; height: number }[] = [
  { id: "iphone", label: "iPhone", icon: "i-mingcute-cellphone-line", width: 393, height: 852 },
  { id: "ipad", label: "iPad", icon: "i-mingcute-pad-line", width: 820, height: 1180 },
  { id: "laptop", label: "Laptop", icon: "i-mingcute-laptop-line", width: 1280, height: 800 },
  { id: "desktop", label: "Desktop", icon: "i-mingcute-monitor-line", width: 1920, height: 1080 },
]

export type DeviceId = Preset | "fill" | "custom"
/** The page's size: a device's, one typed or dragged (`custom`), or the whole pane (`fill`, which ignores the numbers). */
export type DeviceSize = { id: DeviceId; width: number; height: number }

// Chrome's device mode and T3 Code's preview take the same bounds.
export const DEVICE_MIN = 240
export const DEVICE_MAX = 3840
export const clampDevice = (value: number) => Math.round(Math.min(DEVICE_MAX, Math.max(DEVICE_MIN, value)))

export const deviceOf = (id: DeviceId) => DEVICES.find((device) => device.id === id)
