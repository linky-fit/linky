import { Glob } from "bun";
import { gzipSync } from "node:zlib";

// Total gzip size of the exported app JS, set a little above the current
// build. Raise it deliberately when a change is worth the bytes.
const BUDGET_GZIP_BYTES = 1950 * 1024;

export const checkBundleSize = async (dist: string): Promise<void> => {
  let total = 0;
  for await (const file of new Glob("_expo/static/js/**/*.js").scan(dist)) {
    total += gzipSync(await Bun.file(`${dist}/${file}`).bytes()).byteLength;
  }
  const kib = (bytes: number) => `${(bytes / 1024).toFixed(0)} KiB`;
  console.log(`app JS: ${kib(total)} gzip (budget ${kib(BUDGET_GZIP_BYTES)})`);
  if (total > BUDGET_GZIP_BYTES)
    throw new Error(
      `app JS exceeds its gzip budget by ${kib(total - BUDGET_GZIP_BYTES)}`,
    );
};
