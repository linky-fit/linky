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
