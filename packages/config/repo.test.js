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

test.each([
  "docker/web-app/Dockerfile",
  "apps/push/Dockerfile",
  "apps/supporter/Dockerfile",
])("%s copies every workspace manifest before bun install", (dockerfile) => {
  const missing = workspaces.filter(
    (workspace) =>
      !read(dockerfile).includes(`COPY ${workspace}/package.json `),
  );
  expect(missing).toEqual([]);
});

test("the evolu relay pins the web app's @evolu/common version", () => {
  const installed = ["apps/web-app/node_modules", "node_modules"]
    .map((dir) => join(dir, "@evolu/common/package.json"))
    .find((path) => existsSync(join(root, path)));
  const webApp = readJson(installed);
  const relay = readJson("docker/evolu-relay/package.json");
  expect(relay.dependencies["@evolu/common"]).toBe(webApp.version);
});
