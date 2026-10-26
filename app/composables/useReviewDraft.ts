// A new comment keeps its text and images when the reviewer adds or removes an area.
export const [provideReviewDraft, injectReviewDraft] = createInjectionState(() => ({
  body: ref(""),
  images: useImagePicks(),
}))
