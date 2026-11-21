const imageExtensions = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
  ["image/bmp", ".bmp"],
])

export const EDITOR_IMAGE_PICK = [...imageExtensions.keys()].join(",")
export const editorImageExtension = (type: string) => imageExtensions.get(type)
