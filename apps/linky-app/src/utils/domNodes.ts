// Tamagui hands refs a DOM node on the web and a native view on iOS and
// Android, where the DOM classes do not exist.

export const asDivElement = (node: unknown): HTMLDivElement | null =>
  typeof HTMLDivElement !== "undefined" && node instanceof HTMLDivElement
    ? node
    : null;

export const asInputElement = (node: unknown): HTMLInputElement | null =>
  typeof HTMLInputElement !== "undefined" && node instanceof HTMLInputElement
    ? node
    : null;
