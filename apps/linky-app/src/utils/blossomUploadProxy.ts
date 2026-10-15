const LINKY_WEB_APP_ORIGIN = "https://app.linky.fit";

export const getBlossomUploadProxyUrl = (): string => {
  if (typeof window === "undefined") {
    return `${LINKY_WEB_APP_ORIGIN}/api/blossom-upload`;
  }

  const { hostname, origin, protocol } = window.location;
  const isLocalDevelopment =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]";
  if ((protocol === "https:" || protocol === "http:") && !isLocalDevelopment) {
    return `${origin}/api/blossom-upload`;
  }

  return `${LINKY_WEB_APP_ORIGIN}/api/blossom-upload`;
};
