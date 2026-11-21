import { typesetStylesheet } from "comark-ui/client"
import shell from "./document-shell.css?raw"
import css from "./typeset.css?raw"

export const TYPESET_CSS = typesetStylesheet(".typeset") + css + shell
