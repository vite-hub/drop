import { isPublic, type Share, SHARE_ICONS } from "#shared/share"
import type { DropSummary } from "#shared/types"
import { dropPath } from "#shared/links"

export function useDropItem(drop: () => DropSummary, options: { inTeam?: () => boolean; trash: () => void }) {
  const now = useRelativeNow()
  const { copy } = useCopy()
  const { setShare, setPinned } = useDropActions()
  const pinned = useDropPin(drop)
  const moveTo = useMoveDialog()
  const { data: me } = useMe()
  const shared = computed(() => drop().share !== "private")
  const theirs = computed(() => Boolean(drop().owner))
  const changeable = computed(() => !theirs.value && (!drop().teamFolder || me.value?.role === "admin"))
  const choices = computed(() => shareItems(me.value, drop()))
  const status = computed(() => shareStatus(drop(), now.value))
  const link = useShareUrl(drop)

  const pick = (next: Share) => next === drop().share || setShare(drop(), next)

  const copyLink = (announce?: string) => copy(link.value, { announce })

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
      ...(drop().trashedAt
        ? []
        : [
            pinned.value
              ? { label: "Unpin", icon: "i-mingcute-pin-fill", onSelect: () => void setPinned(drop(), false) }
              : { label: "Pin", icon: "i-mingcute-pin-line", onSelect: () => void setPinned(drop(), true) },
          ]),
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

  return { shared, theirs, changeable, choices, status, pinned, pick, link, copyLink, linkChoices, menu }
}
