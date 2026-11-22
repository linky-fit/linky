import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const readJson = (path) => JSON.parse(read(path));

const workspaces = readJson("package.json").workspaces.flatMap((pattern) => {
  const dir = pattern.replace(/\/\*$/, "");
  return readdirSync(join(root, dir))
    .map((name) => `${dir}/${name}`)
    .filter((workspace) => existsSync(join(root, workspace, "package.json")));
});

test.each(["docker/linky-app/Dockerfile", "apps/push/Dockerfile"])(
  "%s copies every workspace manifest before bun install",
  (dockerfile) => {
    const missing = workspaces.filter(
      (workspace) =>
        !read(dockerfile).includes(`COPY ${workspace}/package.json `),
    );
    expect(missing).toEqual([]);
  },
);
