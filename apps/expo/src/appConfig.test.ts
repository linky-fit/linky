import { afterEach, describe, expect, it } from "bun:test";
import path from "node:path";
import appConfig from "../app.config.ts";

const names = [
  "LINKY_APP_VARIANT",
  "LINKY_ANDROID_VERSION_CODE",
  "LINKY_NATIVE_SERVICES",
] as const;
const saved = names.map((name) => [name, process.env[name]] as const);

afterEach(() => {
  for (const [name, value] of saved)
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
});

const configWith = (env: Partial<Record<(typeof names)[number], string>>) => {
  for (const name of names) delete process.env[name];
  Object.assign(process.env, env);
  return appConfig({
    projectRoot: path.join(import.meta.dir, ".."),
    staticConfigPath: null,
    packageJsonPath: null,
    config: {},
  });
};

describe("app.config", () => {
  it("derives the dev variant's version code from the app version", () => {
    const config = configWith({});
    const [major, minor, patch] = (config.version ?? "").split(".").map(Number);
    expect(config.android?.versionCode).toBe(
      (major ?? 0) * 10000 + (minor ?? 0) * 100 + (patch ?? 0),
    );
    expect(config.ios?.buildNumber).toBe(config.version);
  });

  it("builds the production config without an Android version code, as the web export does", () => {
    const config = configWith({ LINKY_APP_VARIANT: "production" });
    expect(config.ios?.bundleIdentifier).toBe("fit.linky.app");
    expect(config.android?.package).toBe("fit.linky.app");
  });

  it("rejects a malformed version code and an unknown services mode", () => {
    expect(() => configWith({ LINKY_ANDROID_VERSION_CODE: "12a" })).toThrow(
      /positive integer/,
    );
    expect(() => configWith({ LINKY_NATIVE_SERVICES: "staging" })).toThrow(
      /production or local/,
    );
  });
});
