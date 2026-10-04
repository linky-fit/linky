import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Fetch } from "../domain";

const fixtures = join(import.meta.dirname, "../__fixtures__");

/** When and from which join URL `scripts/captureFixtures.ts` captured the demo publisher. */
export const demoCapture: {
  readonly capturedAt: string;
  readonly joinUrl: string;
} = JSON.parse(readFileSync(join(fixtures, "capture.json"), "utf8"));

export const DEMO_NOW = new Date(demoCapture.capturedAt);

/** Serves the captured files by URL, 404 for anything else, and records every request. */
export const makeFixtureFetch = () => {
  const requests: string[] = [];
  const fetch: Fetch = async (url) => {
    requests.push(url);
    const { host, pathname } = new URL(url);
    try {
      return new Response(readFileSync(join(fixtures, host, pathname)), {
        status: 200,
      });
    } catch {
      return new Response("not found", { status: 404 });
    }
  };
  return { fetch, requests };
};

export const readDemoFile = (url: string): string => {
  const { host, pathname } = new URL(url);
  return readFileSync(join(fixtures, host, pathname), "utf8");
};
