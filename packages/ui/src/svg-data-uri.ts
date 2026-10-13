const SVG_DATA_URI = /^data:image\/svg\+xml([^,]*),(.*)$/is;
const ESCAPE_RUN = /(?:%[0-9a-f]{2})+/gi;

const decodeRun = (run: string): string => {
  try {
    return decodeURIComponent(run);
  } catch {
    return run;
  }
};

/** The SVG markup inside a `data:image/svg+xml` URI, or null for any other URI. */
export function svgDataUriXml(uri: string): string | null {
  const match = SVG_DATA_URI.exec(uri);
  if (!match) return null;
  const [, params, payload] = match;
  if (!/;base64/i.test(params)) return payload.replace(ESCAPE_RUN, decodeRun);
  try {
    return atob(payload);
  } catch {
    return null;
  }
}
