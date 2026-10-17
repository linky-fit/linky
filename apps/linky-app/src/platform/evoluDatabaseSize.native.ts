import { File } from "expo-file-system";
import { defaultDatabaseDirectory } from "expo-sqlite";

// expo-sqlite names the directory by a plain path; expo-file-system takes a URI.
export const databaseDirectoryUri = (): string => {
  const directory = String(defaultDatabaseDirectory);
  return directory.startsWith("file://") ? directory : `file://${directory}`;
};

/** Bytes of the SQLite database Evolu keeps under `dbName`, with its write-ahead log; 0 when unknown. */
export const evoluDatabaseBytes = async (dbName: string): Promise<number> => {
  // @evolu/react-native names the file `evolu1-<name>.db`.
  const database = `${databaseDirectoryUri()}/evolu1-${dbName}.db`;
  try {
    return [database, `${database}-wal`]
      .map((uri) => new File(uri))
      .reduce((total, file) => total + (file.exists ? file.size : 0), 0);
  } catch {
    return 0;
  }
};
