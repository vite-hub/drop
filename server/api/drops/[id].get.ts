import { defineHandler, HTTPError } from "h3"
import { appFilesGrant } from "../../utils/app-files"
import { contentOrigin, perDropOrigins } from "../../utils/content-origin"
import {
  dropDetail,
  expiredLink,
  findDropAt,
  permissions,
  recordSharedVisit,
  waitingForReview,
} from "../../utils/drops"
import { recordVisit } from "../../utils/expiry"
import { identify } from "../../utils/identity"
import { requestLog } from "../../utils/logs"
import { routeId } from "../../utils/params"
import { runtimeErrors } from "../../utils/runtime-errors"
import { countView } from "../../utils/views"

export default defineHandler(async (event) => {
  const id = await routeId(event)
  const version = Number(event.url.searchParams.get("v")) || undefined
  const [drop, who] = await Promise.all([findDropAt(id, version, event), identify(event)])
  if (waitingForReview(drop, who))
    throw new HTTPError({ status: 403, statusText: "Waiting for review", data: { shareReview: "pending" } })
  if (expiredLink(drop, who))
    throw new HTTPError({ status: 410, statusText: "This drop expired after nobody opened it for a while." })
  if (!drop || !permissions(drop, who).view)
    throw new HTTPError({ status: 404, statusText: "This drop is private, or it was deleted." })
  event.res.headers.set("Cache-Control", "private, no-store")
  const visited = who
    ? Promise.all([
        recordVisit(event, drop, who, "beacon"),
        countView(event, drop, who, "beacon"),
        recordSharedVisit(drop, who, event),
      ])
    : undefined
  const frameOrigin = drop.kind === "app" || drop.kind === "html" ? await contentOrigin(event, drop.id) : null
  const served = drop.kind === "app" && !!frameOrigin && perDropOrigins(event)
  const hub =
    drop.kind === "folder" && permissions(drop, null).view
      ? import("../../utils/hub-skills")
          .then(({ hubInstall }) => hubInstall(drop, event))
          .catch((error: unknown) => {
            requestLog(event)?.warn("Skill hub install metadata failed", {
              hub: { failure: error instanceof Error ? error.message : String(error) },
            })
            return undefined
          })
      : undefined
  const [detail, install, errors] = await Promise.all([
    dropDetail(drop, who, event.url.origin, event, served ? "none" : "all"),
    hub,
    drop.kind === "app" || drop.kind === "html" ? runtimeErrors(drop.id, drop.version) : undefined,
    visited,
  ])
  if (install) detail.install = install
  if (errors?.length) detail.errors = errors
  if (!frameOrigin) return detail
  return {
    ...detail,
    contentOrigin: frameOrigin,
    ...(served ? { contentGrant: await appFilesGrant(event, drop.id, who) } : {}),
  }
})
