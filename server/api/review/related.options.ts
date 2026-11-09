import { reviewApi, reviewPreflight } from "../../utils/review"

/** The preflight for the "Drop document" menu's request with a token: allowed for origins a site drop covers. */
export default reviewApi(reviewPreflight)
