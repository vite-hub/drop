import * as v from "valibot"

const Text = v.string()

/**
 * `value` when it's a string, undefined otherwise: a query parameter given once (not repeated, not a bare `?name`), a
 * form field that isn't a file, a field of parsed JSON.
 */
export const textValue = (value: unknown) => (v.is(Text, value) ? value : undefined)
