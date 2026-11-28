import { EXTENSION_MARKER, extensionBrowser, extensionLink } from "#shared/extension"

export function useExtension() {
  const installed = ref<boolean | null>(null)
  const link = ref(extensionLink(null))
  const read = () => (installed.value = document.documentElement.hasAttribute(EXTENSION_MARKER))
  onMounted(() => {
    link.value = extensionLink(extensionBrowser(navigator.userAgent))
    read()
  })
  useMutationObserver(() => (import.meta.client ? document.documentElement : undefined), read, {
    attributes: true,
    attributeFilter: [EXTENSION_MARKER],
  })
  return { prompt: computed(() => installed.value === false), link }
}
