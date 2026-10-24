/**
 * The room of a doc's link (server/realtime/latest.ts): its digest is the version number of the doc's head. It brings
 * Yjs, so useLatestVersion imports this once the page shows, and readers never wait on it. Run inside an effect scope:
 * leaving the scope leaves the room.
 */
export function joinLatestRoom(link: () => string, enabled: () => boolean) {
  const realtime = useRealtimeTiptap("latest", link, { enabled, identity: null, carets: false })
  // `null` only for a link with no doc behind it.
  return computed(() => Number(realtime.saveStatus.value?.digest) || 0)
}
