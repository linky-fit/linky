import { envBlossomServerUrl } from "../platform/buildEnv";
import { isNativePlatform } from "../platform/runtime";

const PRIMAL_URL = "https://blossom.primal.net";

/** Where photos and image messages are uploaded. */
export const BLOSSOM_SERVER_URL = envBlossomServerUrl?.trim() || PRIMAL_URL;

/**
 * The app's own `/api/blossom-upload`, which relays an upload to Primal when the browser cannot reach it;
 * a native shell has no such route and uses the hosted app's. Null for a build with another server.
 */
export const getBlossomUploadProxyUrl = (): string | null =>
  BLOSSOM_SERVER_URL === PRIMAL_URL
    ? `${isNativePlatform() ? "https://app.linky.fit" : ""}/api/blossom-upload`
    : null;
