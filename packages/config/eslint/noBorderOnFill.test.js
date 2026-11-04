import { RuleTester } from "eslint";
import { noBorderOnFillPlugin } from "./noBorderOnFill.js";

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

tester.run(
  "no-border-on-fill",
  noBorderOnFillPlugin.rules["no-border-on-fill"],
  {
    valid: [
      '<Stack backgroundColor="$surface" borderRadius="$card" />;',
      '<Stack borderWidth={1} borderColor="$accent" />;',
      '<Stack backgroundColor="$transparent" borderWidth={1} />;',
      '<Pressable backgroundColor="$surface" borderWidth={0} />;',
      'styled(View, { backgroundColor: "$surface", padding: 2 });',
      '({ backgroundColor: "$surface", border: "none" });',
    ],
    invalid: [
      {
        code: '<Stack backgroundColor="$surface" borderWidth={border.hairline} />;',
        errors: [{ messageId: "border" }],
      },
      {
        code: "<Row backgroundColor={fill} borderTopWidth={1} />;",
        errors: [{ messageId: "border" }],
      },
      {
        code: 'styled(View, { backgroundColor: "$surface", borderWidth: 1 });',
        errors: [{ messageId: "border" }],
      },
      {
        code: '({ background: x, backgroundColor: "$surface", border: "1px solid red" });',
        errors: [{ messageId: "border" }],
      },
    ],
  },
);
