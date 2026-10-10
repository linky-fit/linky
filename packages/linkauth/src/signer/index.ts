export {
  isCanonicalAuthTemplate,
  LINKAUTH_KIND,
  LINKAUTH_PERMISSION,
} from "../template.js";
export { normalizeAudience } from "../audience.js";
export { fetchDomainDocument } from "../fetchDomain.js";
export type {
  DomainFailure,
  FetchDomainOptions,
  FetchDomainResult,
  LinkauthFetch,
} from "../fetchDomain.js";
export { LINKAUTH_WRAP_KIND, wrapAssertion } from "../wrap.js";
export {
  buildCallbackUrl,
  isLinkauthLink,
  parseLinkauthLink,
  resolveLinkauthLink,
} from "./link.js";
export type {
  LinkauthLink,
  LinkauthLogin,
  ResolveLinkauthResult,
} from "./link.js";
