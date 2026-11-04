const borderWidthKey = /^border(Top|Right|Bottom|Left|Start|End)?Width$/;

/**
 * @typedef {{ type: string; name?: string; value?: unknown; expression?: unknown }} Node
 * @typedef {{ key: Node; value: Node }} KeyValue
 */

/**
 * @param {Node | null | undefined} node
 * @returns {unknown}
 */
const literal = (node) =>
  node?.type === "Literal"
    ? node.value
    : node?.type === "JSXExpressionContainer"
      ? literal(/** @type {Node} */ (node.expression))
      : undefined;

/** @param {Node | null | undefined} value */
const paintsFill = (value) => {
  const color = literal(value);
  return color !== "$transparent" && color !== "transparent";
};

/** @param {Node | null | undefined} value */
const drawsBorder = (value) => {
  const width = literal(value);
  return width !== 0 && width !== "0";
};

/** @param {KeyValue[]} pairs */
const violates = (pairs) => {
  const fill = pairs.find(({ key }) => key.name === "backgroundColor");
  return (
    fill !== undefined &&
    paintsFill(fill.value) &&
    pairs.some(
      ({ key, value }) =>
        (borderWidthKey.test(String(key.name)) && drawsBorder(value)) ||
        (key.name === "border" && literal(value) !== "none"),
    )
  );
};

const noBorderOnFill = {
  /** @type {import("eslint").Rule.RuleMetaData} */
  meta: {
    type: "problem",
    docs: {
      description:
        "A filled area separates by its fill, radius, spacing or shadow, never by an outline as well.",
    },
    schema: [],
    messages: {
      border:
        "Do not draw a border on a filled area; let the fill, spacing or a shadow separate it.",
    },
  },
  /** @param {import("eslint").Rule.RuleContext} context */
  create(context) {
    return {
      /** @param {import("eslint").Rule.Node & { attributes: Array<{ type: string; name: Node; value: Node }> }} node */
      JSXOpeningElement(node) {
        const pairs = node.attributes
          .filter((attribute) => attribute.type === "JSXAttribute")
          .map((attribute) => ({
            key: attribute.name,
            value: attribute.value,
          }));
        if (violates(pairs)) context.report({ node, messageId: "border" });
      },
      /** @param {import("eslint").Rule.Node & { properties: Array<{ type: string; key: Node; value: Node }> }} node */
      ObjectExpression(node) {
        const pairs = node.properties
          .filter((property) => property.type === "Property")
          .map((property) => ({
            key:
              property.key.type === "Literal"
                ? { type: "Identifier", name: String(property.key.value) }
                : property.key,
            value: property.value,
          }));
        if (violates(pairs)) context.report({ node, messageId: "border" });
      },
    };
  },
};

export const noBorderOnFillPlugin = {
  meta: { name: "linky-style" },
  rules: { "no-border-on-fill": noBorderOnFill },
};
