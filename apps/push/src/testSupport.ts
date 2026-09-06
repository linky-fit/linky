import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createStoragePath(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  return join(directory, "push.sqlite");
}

export function removeStoragePath(path: string): void {
  rmSync(join(path, ".."), { recursive: true, force: true });
}
