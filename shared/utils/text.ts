import * as v from "valibot"

const Text = v.string()

export const textValue = (value: unknown) => (v.is(Text, value) ? value : undefined)

export const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
