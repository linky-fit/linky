import { Directory, File as ExpoFile, Paths } from "expo-file-system";
import { decodeBase64Url } from "../utils/base64";

/** A file in the app sandbox, shaped as a DOM File for the code shared with the web. */
export class DeviceFile implements File {
  readonly lastModified = Date.now();
  readonly webkitRelativePath = "";
  readonly uri: string;
  readonly name: string;
  readonly type: string;
  readonly size: number;
  private readonly file: ExpoFile;

  constructor(uri: string, name: string, type: string, size: number) {
    this.uri = uri;
    this.name = name;
    this.type = type;
    this.size = size;
    this.file = new ExpoFile(uri);
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return this.file.arrayBuffer();
  }

  bytes(): Promise<Uint8Array<ArrayBuffer>> {
    return this.file.bytes();
  }

  text(): Promise<string> {
    return this.file.text();
  }

  slice(start?: number, end?: number, contentType?: string): Blob {
    return this.file.slice(start, end, contentType);
  }

  stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
    return this.file.stream();
  }
}

const EXTENSION_BY_TYPE: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

let filesDirectory: Directory | null = null;

// Decrypted chat files live only until the next app start.
const openFilesDirectory = (): Directory => {
  if (filesDirectory) return filesDirectory;
  const directory = new Directory(Paths.cache, "linky-files");
  if (directory.exists) directory.delete();
  directory.create({ intermediates: true });
  filesDirectory = directory;
  return directory;
};

/** Writes `bytes` to a sandbox file named `fileName`, replacing one of that name. */
export const writeDeviceFile = (
  directory: Directory,
  fileName: string,
  bytes: Uint8Array,
  type: string,
): DeviceFile => {
  if (!directory.exists) directory.create({ intermediates: true });
  const file = new ExpoFile(directory, fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  return new DeviceFile(file.uri, file.name, type, bytes.byteLength);
};

export const bytesToDeviceFile = (
  bytes: Uint8Array,
  type: string,
): DeviceFile =>
  writeDeviceFile(
    openFilesDirectory(),
    `${crypto.randomUUID()}.${EXTENSION_BY_TYPE[type] ?? "bin"}`,
    bytes,
    type,
  );

/** The content of a device file or of a React Native blob. */
export const readBlobBytes = async (blob: Blob): Promise<Uint8Array> => {
  if (blob instanceof DeviceFile) return blob.bytes();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read-failed"));
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(blob);
  });
  const bytes = decodeBase64Url(dataUrl.slice(dataUrl.indexOf(",") + 1));
  if (!bytes) throw new Error("read-failed");
  return bytes;
};
