import DOMPurify from "dompurify";

const MEDIA_TAGS = new Set(["IMG", "VIDEO", "AUDIO", "SOURCE", "TRACK"]);

const absoluteUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

/** Shows where a web link really goes, after its publisher-chosen text. */
const labelDestination = (anchor: Element): void => {
  const url = absoluteUrl(anchor.getAttribute("href") ?? "");
  if (url === null) {
    anchor.removeAttribute("href");
    return;
  }
  anchor.setAttribute("target", "_blank");
  anchor.setAttribute("rel", "noopener noreferrer");
  if (url.protocol === "http:" || url.protocol === "https:") {
    anchor.append(` (${url.hostname})`);
  }
};

/**
 * Publisher HTML reduced to inert markup: no scripts, no remote media (only
 * inline `data:` sources survive) and every link labelled with its domain.
 */
export const sanitizeAnnouncementHtml = (html: string): string => {
  // A private instance, so these hooks never apply to other sanitizing.
  const purify = DOMPurify(window);
  purify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A" && node.hasAttribute("href")) {
      labelDestination(node);
    }
    if (
      MEDIA_TAGS.has(node.tagName) &&
      !(node.getAttribute("src") ?? "").startsWith("data:")
    ) {
      node.remove();
    }
  });
  return purify.sanitize(html, {
    // HTML only: SVG and MathML links would escape the labelling above.
    USE_PROFILES: { html: true },
    // `area` links have no text to carry the label.
    FORBID_TAGS: ["form", "input", "button", "textarea", "select", "area"],
    FORBID_ATTR: ["srcset", "poster", "action", "formaction"],
  });
};
