import { readFileSync } from "node:fs";
import type { ScopeDefinition } from "../core";
import { linkyScopes } from "./scopes";

const code = (text: string) => `\`${text}\``;

const tableRow = (scope: string, definition: ScopeDefinition<string>) => {
  const rotating = definition.owner === "shard" && definition.rotation !== null;
  const owner =
    definition.owner === "app"
      ? code("AppOwner")
      : `${code("ShardOwner")} ${code(`["${scope}", ${rotating ? "n" : 0}]`)}`;
  const rotates =
    definition.owner === "shard" && definition.rotation
      ? `${definition.rotation.maxBytes / 1024} KiB or ${definition.rotation.maxMutations} mutations`
      : "no";
  const forget =
    definition.owner === "shard" && definition.forget !== "never"
      ? `keep newest ${definition.forget.keepNewest}`
      : "never";
  const tables = definition.tables.map(code).join(", ");
  return `| ${code(scope)} | ${owner} | ${tables} | ${rotates} | ${forget} |`;
};

describe("linkyScopes", () => {
  it("is rendered as the scope table in docs/concepts.md", () => {
    const concepts = readFileSync(
      new URL("../../docs/concepts.md", import.meta.url),
      "utf8",
    ).replace(/ +/g, " ");
    for (const [scope, definition] of Object.entries(linkyScopes))
      expect(concepts).toContain(tableRow(scope, definition));
  });
});
