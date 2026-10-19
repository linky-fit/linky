import {
  defaultTreeAdapter,
  html as htmlSpec,
  parseFragment,
  serialize,
  type DefaultTreeAdapterTypes,
} from "parse5";

// React Native has no DOM for DOMPurify, so publisher HTML goes through an
// allowlist over parse5, the HTML spec's parser. It keeps keryxHtml.ts's
// guarantees; the web view that shows it also runs without JavaScript.

type ParentNode = DefaultTreeAdapterTypes.ParentNode;
type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type Element = DefaultTreeAdapterTypes.Element;

/** Removed with everything inside: active content, forms and links that cannot carry a label. */
const DROPPED = new Set([
  "applet",
  "area",
  "base",
  "button",
  "canvas",
  "embed",
  "form",
  "frame",
  "frameset",
  "head",
  "iframe",
  "input",
  "link",
  "map",
  "meta",
  "noembed",
  "noframes",
  "noscript",
  "object",
  "option",
  "plaintext",
  "script",
  "select",
  "style",
  "template",
  "textarea",
  "title",
  "xmp",
]);

/** Kept; any other element is replaced by its content. */
const ALLOWED = new Set([
  "a",
  "abbr",
  "address",
  "article",
  "aside",
  "audio",
  "b",
  "bdi",
  "bdo",
  "blockquote",
  "br",
  "caption",
  "center",
  "cite",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "details",
  "dfn",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "i",
  "img",
  "ins",
  "kbd",
  "li",
  "main",
  "mark",
  "nav",
  "ol",
  "p",
  "pre",
  "q",
  "s",
  "samp",
  "section",
  "small",
  "source",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "track",
  "u",
  "ul",
  "var",
  "video",
  "wbr",
]);

const MEDIA = new Set(["img", "video", "audio", "source", "track"]);

const ATTRIBUTES = new Set([
  "abbr",
  "align",
  "alt",
  "colspan",
  "controls",
  "datetime",
  "dir",
  "headers",
  "height",
  "lang",
  "loop",
  "muted",
  "open",
  "reversed",
  "rowspan",
  "scope",
  "span",
  "start",
  "style",
  "title",
  "type",
  "valign",
  "value",
  "width",
]);

const LINK_PROTOCOLS = new Set([
  "http:",
  "https:",
  "mailto:",
  "tel:",
  "sms:",
  "ftp:",
]);

const isElement = (node: ChildNode): node is Element => "tagName" in node;

const absoluteUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const attribute = (element: Element, name: string): string | undefined =>
  element.attrs.find((attr) => attr.name === name)?.value;

/** Keeps a link only to an absolute URL, opened outside the frame and labelled with its real domain. */
const labelLink = (anchor: Element, href: string | undefined): void => {
  const url = href === undefined ? null : absoluteUrl(href);
  if (url === null || !LINK_PROTOCOLS.has(url.protocol)) return;
  anchor.attrs.push(
    { name: "href", value: url.href },
    { name: "target", value: "_blank" },
    { name: "rel", value: "noopener noreferrer" },
  );
  if (url.protocol === "http:" || url.protocol === "https:") {
    defaultTreeAdapter.insertText(anchor, ` (${url.hostname})`);
  }
};

const sanitizeChildren = (parent: ParentNode): void => {
  const kept: ChildNode[] = [];
  for (const child of parent.childNodes) {
    if (!isElement(child)) {
      if (child.nodeName === "#text") kept.push(child);
      continue;
    }
    const tag = child.tagName;
    if (child.namespaceURI !== htmlSpec.NS.HTML || DROPPED.has(tag)) continue;
    const src = attribute(child, "src");
    if (MEDIA.has(tag) && !(src ?? "").startsWith("data:")) continue;
    sanitizeChildren(child);
    if (!ALLOWED.has(tag)) {
      for (const grandchild of child.childNodes) {
        grandchild.parentNode = parent;
        kept.push(grandchild);
      }
      continue;
    }
    const href = attribute(child, "href");
    child.attrs = child.attrs.filter(
      (attr) =>
        ATTRIBUTES.has(attr.name) || (attr.name === "src" && MEDIA.has(tag)),
    );
    if (tag === "a") labelLink(child, href);
    kept.push(child);
  }
  parent.childNodes = kept;
};

/**
 * Publisher HTML reduced to inert markup: no scripts, no remote media (only
 * inline `data:` sources survive) and every link labelled with its domain.
 */
export const sanitizeAnnouncementHtml = (html: string): string => {
  const fragment = parseFragment(html);
  sanitizeChildren(fragment);
  return serialize(fragment);
};
