import { envBlossomServerUrl } from "../platform/buildEnv";
import { isNativePlatform } from "../platform/runtime";

/** Where photos and image messages are uploaded. */
export const BLOSSOM_SERVER_URL =
  envBlossomServerUrl?.trim() || "https://blossom.primal.net";

/** The app's own `/api/blossom-upload`; a native shell has no such route and uses the hosted app's. */
export const getBlossomUploadProxyUrl = (): string =>
  `${isNativePlatform() ? "https://app.linky.fit" : ""}/api/blossom-upload`;
