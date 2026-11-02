// comark-ui's typeset (shadcn/typeset on the --comark-* tokens) on .typeset, Drop's own blocks, and the page around them:
// one copy shared by the /f/ document pages and the viewer's sandboxed documents. The app imports comark-ui/typeset.css
// and typeset.css (for the live editor); document-shell.css would restyle every app page.
import { typesetStylesheet } from "comark-ui/client"
import shell from "./document-shell.css?raw"
import css from "./typeset.css?raw"

export const TYPESET_CSS = typesetStylesheet(".typeset") + css + shell
