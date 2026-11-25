import { defineValidatedHandler, HTTPError } from "h3"
import { ReviewOpenSchema } from "#shared/schemas"
import { authError } from "../../utils/auth-errors"
import { dropPageUrl, findDrop } from "../../utils/drops"
import { identify } from "../../utils/identity"
import { openable, openDoc, readReviewToken } from "../../utils/review"

export default defineValidatedHandler({
  validate: { body: ReviewOpenSchema },
  async handler(event) {
    const who = await identify(event)
    const body = await event.req.json()
    if ("doc" in body) {
      if (!who) throw authError("DOCUMENT_SIGN_IN_REQUIRED")
      const doc = await openDoc(event, body.doc, who)
      if (!doc)
        throw new HTTPError({
          status: 404,
          statusText:
            "Only people the document is shared with can open it. If it is shared with you, open it from the site again.",
        })
      event.res.headers.set("Cache-Control", "no-store")
      return { to: `/drops/${doc.id}` }
    }
    const claims = await readReviewToken(event, body.token)
    const site = claims ? await findDrop(claims.d, event) : null
    if (!who) throw authError("REVIEW_SIGN_IN_REQUIRED")
    if (!site || site.kind !== "site" || !openable(site, who))
      throw new HTTPError({
        status: 404,
        statusText: "Only people the review is shared with can open it. Your comments still reach its owner.",
      })
    event.res.headers.set("Cache-Control", "no-store")
    return { to: `/drops/${site.id}`, link: dropPageUrl(event.url.origin, site) }
  },
})
