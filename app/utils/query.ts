import * as v from "valibot"

const Text = v.string()

/** A query parameter's text when the URL has it once. Repeated parameters, and a bare `?name`, read as missing. */
export const queryText = (value: unknown) => (v.is(Text, value) ? value : undefined)
