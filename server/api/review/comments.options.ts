import { reviewApi, reviewPreflight } from "../../utils/review"

/** The preflight for the review script's requests: allowed for origins a site drop covers, with a token, no cookies. */
export default reviewApi(reviewPreflight)
