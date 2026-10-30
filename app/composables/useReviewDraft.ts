// A new comment keeps its text and images when the reviewer adds or removes an area.
export const [provideReviewDraft, injectReviewDraft] = createInjectionState(() => {
  const body = ref("")
  const images = useImagePicks()
  const sending = ref(false)
  // Waiting for the picture of the area being commented on before it sends (DropViewer's submit).
  const waiting = ref(false)
  let revision = 0
  watch([body, images.picks], () => revision++, { flush: "sync" })

  // Ownership lives with the draft, so replacing a composer cannot start a second send.
  function beginSend() {
    if (sending.value) return
    sending.value = true
    const sentRevision = revision
    let finished = false
    return (accepted: boolean) => {
      if (finished) return false
      finished = true
      sending.value = false
      if (!accepted || revision !== sentRevision) return false
      body.value = ""
      images.clear()
      return true
    }
  }

  return { body, images, sending, waiting, beginSend }
})
