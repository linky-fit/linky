/** Bytes of the OPFS SQLite database Evolu keeps under `dbName`; 0 when unknown. */
export const evoluDatabaseBytes = async (dbName: string): Promise<number> => {
  try {
    const root = await navigator.storage?.getDirectory?.();
    if (!root) return 0;

    const expectedDir = `.${dbName}`;

    let totalSize = 0;
    const allDirs: string[] = [];
    // @ts-expect-error OPFS FileSystemDirectoryHandle.entries() not yet in all TS libs
    for await (const [name, handle] of root.entries()) {
      if (handle.kind === "directory") allDirs.push(name);
      if (name === expectedDir && handle.kind === "directory") {
        for await (const [sub, subH] of handle.entries()) {
          if (sub === ".opaque" && subH.kind === "directory") {
            let maxSize = 0;
            for await (const [, fileH] of subH.entries()) {
              if (fileH.kind === "file") {
                const f = await fileH.getFile();
                if (f.size > maxSize) maxSize = f.size;
              }
            }
            totalSize = maxSize; // Take only the largest file (main SQLite)
          }
        }
        break;
      }
    }
    return totalSize;
  } catch {
    return 0;
  }
};
