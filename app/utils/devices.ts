/** The devices the device bar offers, in CSS pixels, the way each usually stands. A phone, a tablet, a laptop, a desktop. */
type Preset = "iphone" | "ipad" | "laptop" | "desktop"
export const DEVICES: { id: Preset; label: string; icon: string; width: number; height: number }[] = [
  { id: "iphone", label: "iPhone", icon: "i-mingcute-cellphone-line", width: 393, height: 852 },
  { id: "ipad", label: "iPad", icon: "i-mingcute-pad-line", width: 820, height: 1180 },
  { id: "laptop", label: "Laptop", icon: "i-mingcute-laptop-line", width: 1280, height: 800 },
  { id: "desktop", label: "Desktop", icon: "i-mingcute-monitor-line", width: 1920, height: 1080 },
]

/** Device mode: whether it's on, and the size, a device's or one typed or dragged (`custom`). Off, the page fills. */
export type DeviceSize = { on: boolean; id: Preset | "custom"; width: number; height: number }

/** The widths Chrome's device mode marks above the page, narrowest first. A click sets the page to one. */
export const BREAKPOINTS = [
  { label: "Mobile S", width: 320 },
  { label: "Mobile M", width: 375 },
  { label: "Mobile L", width: 425 },
  { label: "Tablet", width: 768 },
  { label: "Laptop", width: 1024 },
  { label: "Laptop L", width: 1440 },
  { label: "4K", width: 2560 },
]

// Chrome's device mode and T3 Code's preview take the same bounds.
export const DEVICE_MIN = 240
export const DEVICE_MAX = 3840
export const clampDevice = (value: number) => Math.round(Math.min(DEVICE_MAX, Math.max(DEVICE_MIN, value)))

export const deviceOf = (id: DeviceSize["id"]) => DEVICES.find((device) => device.id === id)
/** The device with this size, either way up. */
export const deviceMatching = (width: number, height: number) =>
  DEVICES.find(
    (item) => (item.width === width && item.height === height) || (item.width === height && item.height === width),
  )?.id ?? "custom"
