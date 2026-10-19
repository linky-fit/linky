import { bytesToDeviceFile, DeviceFile } from "./deviceFile.native";

export const bytesToBlob: (bytes: Uint8Array, type: string) => Blob =
  bytesToDeviceFile;

// React Native's own blobs (fetch responses, string blobs) have blob: URLs.
export const blobUrl = (blob: Blob): string =>
  blob instanceof DeviceFile ? blob.uri : URL.createObjectURL(blob);

export const revokeBlobUrl = (url: string): void => {
  if (url.startsWith("blob:")) URL.revokeObjectURL(url);
};
