/** Binary content as a Blob the platform can show, share and save. */
export const bytesToBlob = (bytes: Uint8Array, type: string): Blob =>
  new Blob([new Uint8Array(bytes)], { type });

/** A URL an image element can load `blob` from, until `revokeBlobUrl`. */
export const blobUrl = (blob: Blob): string => URL.createObjectURL(blob);

export const revokeBlobUrl = (url: string): void => URL.revokeObjectURL(url);
