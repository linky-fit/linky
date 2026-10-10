export { normalizeAudience } from "./audience.js";
export { DOMAIN_DOCUMENT_PATH, parseDomainDocument } from "./domain.js";
export type {
  DomainDocumentProblem,
  DomainDocumentResult,
  LinkauthDomain,
} from "./domain.js";
export { fetchDomainDocument } from "./fetchDomain.js";
export type {
  DomainFailure,
  FetchDomainOptions,
  FetchDomainResult,
  LinkauthFetch,
} from "./fetchDomain.js";
export { createNonce, isNonce } from "./nonce.js";
export {
  authTemplate,
  isCanonicalAuthTemplate,
  LINKAUTH_KIND,
  LINKAUTH_PERMISSION,
} from "./template.js";
export { isLinkauthAssertion } from "./types.js";
export type { LinkauthAssertion, LinkauthTemplate } from "./types.js";
export { LINKAUTH_WRAP_KIND } from "./wrap.js";
