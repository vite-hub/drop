import { reviewApi, reviewPreflight } from "../../utils/review"

/** The preflight for review.js's presence ticket request: allowed for origins a site drop covers. */
export default reviewApi(reviewPreflight)
