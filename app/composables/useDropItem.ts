import { isPublic, type Share, SHARE_ICONS } from "#shared/share"
import type { DropSummary } from "#shared/types"
import { dropPath } from "#shared/links"

/**
 * What a drop listed on the Drops page can do, the same from a row (DropRow), a card (DropCard) or a line (DropLine):
 * its share and the choices for it, copying its link, and its ⋯ menu. In a team folder (`inTeam`) anyone may move a
 * teammate's drop to the Trash; `trash` does that.
 */
export function useDropItem(drop: () => DropSummary, options: { inTeam?: () => boolean; trash: () => void }) {
  const now = useRelativeNow()
  const { copy, copied } = useCopy()
  const { setShare } = useDropActions()
  const moveTo = useMoveDialog()
  const { data: me } = useMe()
  const shared = computed(() => drop().share !== "private")
  // Someone else's drop, in Shared with me or a team folder: open it and copy its link; in a team folder, trash it too.
  const theirs = computed(() => Boolean(drop().owner))
  // The team's folders are the admins' to share.
  const changeable = computed(() => !theirs.value && (!drop().teamFolder || me.value?.role === "admin"))
  const choices = computed(() => shareItems(me.value, drop()))
  const status = computed(() => shareStatus(drop(), now.value))
  const link = useShareUrl(drop)

  // The share menu shows the new choice, so picking one doesn't get a note.
  const pick = (next: Share) => next === drop().share || setShare(drop(), next)

  /** The link button shows a check once it copied; from the menu, which closes, `announce` says it in StatusNote. */
  const copyLink = (announce?: string) => copy(link.value, { announce })

  // Copying never widens a share on its own. A private drop's link button and menu item open the choices instead,
  // each saying who it lets in, the team first. Empty when sharing isn't this person's to change.
  const shareAndCopy = (next: Share) => async () => {
    if (await pick(next)) await copy(link.value, { announce: `${SHARED_TITLES[next]}. Link copied` })
  }
  const offers = computed(() =>
    choices.value
      .filter((item) => !item.disabled && (item.value === "team" || item.value === "public"))
      .map((item) => ({
        label: item.value === "team" ? "Share with team & copy" : "Public link & copy",
        icon: SHARE_ICONS[item.value],
        onSelect: shareAndCopy(item.value),
      })),
  )
  const linkChoices = computed(() =>
    shared.value || !changeable.value
      ? undefined
      : [
          [{ type: "label" as const, label: "Only you can open this" }],
          offers.value.length
            ? offers.value
            : [{ label: "Share it before you copy its link", icon: "i-mingcute-lock-line", disabled: true }],
        ],
  )

  const menu = computed(() => [
    [
      { label: "Open", icon: "i-mingcute-eye-2-line", to: `/drops/${drop().id}` },
      {
        label: isPublic(drop().share) ? "Open public page" : "Open shared page",
        icon: "i-mingcute-external-link-line",
        to: dropPath(drop()),
        target: "_blank",
        disabled: !shared.value,
      },
      linkChoices.value
        ? { label: "Copy link", icon: "i-mingcute-link-line", children: linkChoices.value }
        : { label: "Copy link", icon: "i-mingcute-link-line", onSelect: () => void copyLink("Link copied") },
    ],
    ...(changeable.value
      ? [
          [
            {
              label: "Move to folder",
              icon: "i-mingcute-new-folder-line",
              onSelect: () => void moveTo({ drop: drop() }),
            },
            { label: "Move to Trash", icon: "i-mingcute-delete-2-line", onSelect: options.trash },
          ],
        ]
      : theirs.value && options.inTeam?.()
        ? [[{ label: "Move to Trash", icon: "i-mingcute-delete-2-line", onSelect: options.trash }]]
        : []),
  ])

  return { shared, theirs, changeable, choices, status, pick, copyLink, copied, linkChoices, menu }
}
