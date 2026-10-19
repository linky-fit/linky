import { apiUrl, hostedApiUrl, isLocalOrigin } from "../platform/runtime";

const PATH = "/api/blossom-upload";

// Local dev servers run no blossom-upload function.
export const getBlossomUploadProxyUrl = (): string =>
  isLocalOrigin() ? hostedApiUrl(PATH) : apiUrl(PATH);
