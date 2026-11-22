import { isNativePlatform } from "../platform/runtime";

/** The app's own `/api/blossom-upload`; a native shell has no such route and uses the hosted app's. */
export const getBlossomUploadProxyUrl = (): string =>
  `${isNativePlatform() ? "https://app.linky.fit" : ""}/api/blossom-upload`;
