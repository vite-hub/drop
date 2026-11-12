import type { ComarkKitOptions } from "comark-ui/editor"

/** Links don't open on click while editing, so a click on one places the caret. */
export const LIVE_EDITOR_KIT: ComarkKitOptions = { starterKit: { link: { openOnClick: false } } }
