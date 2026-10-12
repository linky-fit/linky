// @vitest-environment node
import {
  platformSeamPlugin,
  platformSeamRules,
} from "@linky-fit/config/eslint";
import { ESLint } from "eslint";
import { expect, test } from "vitest";
import { platformSeamRatchet } from "./eslint.config.js";

test("the platform seam ratchet is sorted", () => {
  expect(platformSeamRatchet).toEqual(platformSeamRatchet.toSorted());
});

test("every file on the platform seam ratchet still reaches past the seam", async () => {
  const eslint = new ESLint({
    cwd: import.meta.dirname,
    overrideConfig: {
      files: platformSeamRatchet,
      plugins: { "platform-seam": platformSeamPlugin },
      rules: platformSeamRules(""),
    },
    ruleFilter: ({ ruleId }) => ruleId.startsWith("platform-seam/"),
  });
  const results = await eslint.lintFiles(platformSeamRatchet);
  const clean = results
    .filter((result) => result.messages.length === 0)
    .map((result) => result.filePath);
  expect(clean).toEqual([]);
}, 30_000);

test("only platform/buildEnv.ts reads import.meta.env", async () => {
  const eslint = new ESLint({
    cwd: import.meta.dirname,
    ruleFilter: ({ ruleId }) => ruleId === "no-restricted-syntax",
  });
  const lint = async (code, filePath) => {
    const [result] = await eslint.lintText(code, { filePath });
    return result.messages.map((message) => message.message);
  };
  const envMessage = "Read build-time env from platform/buildEnv.ts.";

  for (const code of [
    "export const a = import.meta.env.DEV;",
    'export const b = import.meta["env"].DEV;',
    "const { env } = import.meta;\nexport const c = env.DEV;",
  ]) {
    expect(await lint(code, "src/utils/mint.ts")).toContain(envMessage);
  }
  expect(
    await lint(
      'export const url = new URL("./x.js", import.meta.url);',
      "src/utils/mint.ts",
    ),
  ).toEqual([]);
  expect(
    await lint(
      "export const isDev = import.meta.env.DEV;",
      "src/platform/buildEnv.ts",
    ),
  ).toEqual([]);
}, 30_000);
