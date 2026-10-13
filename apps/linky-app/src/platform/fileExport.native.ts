import { Directory, File as ExpoFile, Paths } from "expo-file-system";
import { Asset, requestPermissionsAsync } from "expo-media-library";
import * as Sharing from "expo-sharing";
import { type FileExport, type PhotoLibrarySave } from "./fileExportShared";
import {
  DeviceFile,
  readBlobBytes,
  writeDeviceFile,
} from "./deviceFile.native";

export {
  type FileExport,
  isCancelledShareError,
  type PhotoLibrarySave,
} from "./fileExportShared";

const exportDirectory = new Directory(Paths.cache, "linky-exports");

const writeExportFile = async (
  blob: Blob,
  fileName: string,
): Promise<DeviceFile> => {
  if (blob instanceof DeviceFile && blob.name === fileName) return blob;
  if (blob instanceof DeviceFile) {
    if (!exportDirectory.exists)
      exportDirectory.create({ intermediates: true });
    const target = new ExpoFile(exportDirectory, fileName);
    if (target.exists) target.delete();
    new ExpoFile(blob.uri).copy(target);
    return new DeviceFile(target.uri, fileName, blob.type, blob.size);
  }
  return writeDeviceFile(
    exportDirectory,
    fileName,
    await readBlobBytes(blob),
    blob.type,
  );
};

/** The app has no downloads folder: the share sheet offers saving the file. */
export const downloadFileInBrowser = (blob: Blob, fileName: string): void => {
  void shareFileNatively({ blob, fileName, title: fileName }).catch(
    () => undefined,
  );
};

export const shareFileNatively = async ({
  blob,
  fileName,
  title,
}: FileExport): Promise<void> => {
  const file = await writeExportFile(blob, fileName);
  await Sharing.shareAsync(file.uri, {
    dialogTitle: title,
    ...(file.type ? { mimeType: file.type } : {}),
  });
};

export const saveFile = (file: FileExport): Promise<void> =>
  shareFileNatively(file);

/** Asks for add-only photo access the first time, then saves the image as a new photo. */
export const saveImageToPhotoLibrary: (
  file: FileExport,
) => Promise<PhotoLibrarySave> = async ({ blob, fileName }) => {
  const permission = await requestPermissionsAsync(true, ["photo"]);
  if (!permission.granted) return "denied";
  const file = await writeExportFile(blob, fileName);
  await Asset.create(file.uri);
  return "saved";
};
