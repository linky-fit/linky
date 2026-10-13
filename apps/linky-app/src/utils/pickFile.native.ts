import { File as ExpoFile } from "expo-file-system";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Alert } from "react-native";
import { getInitialLang, translations } from "../i18n";
import { DeviceFile } from "../platform/deviceFile.native";

interface PickFilesOptions {
  accept: string;
  multiple?: boolean;
}

const fileNameOf = (uri: string): string =>
  decodeURIComponent(uri.split("/").pop() ?? "file");

const pickImages = async (multiple: boolean): Promise<File[]> => {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: multiple,
    quality: 1,
  });
  if (result.canceled) return [];
  return result.assets.map(
    (asset) =>
      new DeviceFile(
        asset.uri,
        asset.fileName ?? fileNameOf(asset.uri),
        asset.mimeType ?? "image/jpeg",
        asset.fileSize ?? new ExpoFile(asset.uri).size,
      ),
  );
};

const pickDocuments = async (
  mimeTypes: string[],
  multiple: boolean,
): Promise<File[]> => {
  const result = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple,
    type: mimeTypes.length > 0 ? mimeTypes : "*/*",
  });
  if (result.canceled) return [];
  return result.assets.map(
    (asset) =>
      new DeviceFile(
        asset.uri,
        asset.name,
        asset.mimeType ?? "",
        asset.size ?? new ExpoFile(asset.uri).size,
      ),
  );
};

type PickSource = "photos" | "files";

// Like a mobile browser's file input, a picker taking images and documents asks where to pick from.
const askPickSource = (): Promise<PickSource | null> =>
  new Promise((resolve) => {
    const t = translations[getInitialLang()];
    Alert.alert(
      t.pickSourceTitle,
      undefined,
      [
        { text: t.pickSourcePhotos, onPress: () => resolve("photos") },
        { text: t.pickSourceFiles, onPress: () => resolve("files") },
        { text: t.cancel, style: "cancel", onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });

/** Opens the photo library or the document picker; resolves with the chosen files, or none when cancelled. */
export const pickFiles = async ({
  accept,
  multiple = false,
}: PickFilesOptions): Promise<File[]> => {
  const mimeTypes = accept
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.includes("/"));
  const takesImages = mimeTypes.some((type) => type.startsWith("image/"));
  const takesOthers = mimeTypes.some((type) => !type.startsWith("image/"));
  const source = !takesImages
    ? "files"
    : takesOthers
      ? await askPickSource()
      : "photos";
  if (source === "photos") return pickImages(multiple);
  if (source === "files") return pickDocuments(mimeTypes, multiple);
  return [];
};

export const pickFile = async (accept: string): Promise<File | null> =>
  (await pickFiles({ accept }))[0] ?? null;

/** Lets a hook open the file picker of a mounted component. */
export interface FilePickerHandle {
  pick: () => void;
}
