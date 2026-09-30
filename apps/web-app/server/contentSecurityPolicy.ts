import { createHash } from "node:crypto";
import type { Plugin } from "vite";

export const contentSecurityPolicyMeta = (): Plugin => {
  let allowLocalhost = false;

  return {
    name: "csp-meta",
    apply: "build",
    configResolved(config) {
      // The only way a production build's CSP admits local http/ws services;
      // the E2E image sets it and keeps CSP active, production never does.
      allowLocalhost = config.env.VITE_ALLOW_INSECURE_LOCALHOST_RELAYS === "1";
    },
    transformIndexHtml: {
      // Hash after other HTML hooks have injected or changed inline scripts.
      order: "post",
      handler(html) {
        const hashes = Array.from(
          html.matchAll(
            /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi,
          ),
          ([, script = ""]) =>
            `'sha256-${createHash("sha256").update(script).digest("base64")}'`,
        );
        const localConnections = allowLocalhost
          ? " http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*"
          : "";
        const policy = [
          "default-src 'self'",
          "base-uri 'self'",
          "object-src 'none'",
          "frame-src 'none'",
          "worker-src 'self' blob:",
          "manifest-src 'self'",
          `script-src 'self' 'wasm-unsafe-eval' ${hashes.join(" ")}`,
          "style-src 'self' 'unsafe-inline'",
          "font-src 'self'",
          "img-src 'self' data: blob: https:",
          "media-src 'self' blob: data:",
          `connect-src 'self' https: wss: blob: data:${localConnections}`,
          "form-action 'self'",
        ].join("; ");

        return [
          {
            tag: "meta",
            attrs: { "http-equiv": "Content-Security-Policy", content: policy },
            injectTo: "head-prepend",
          },
        ];
      },
    },
  };
};
