export const safeDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const stripLightningPrefix = (value: string): string =>
  value.replace(/^lightning:/i, "").trim();
