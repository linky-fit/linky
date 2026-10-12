import { isScreen } from "./landing/copy";
import { ScaledScreen } from "./landing/demo/ScaledScreen";
import { DemoScreen } from "./landing/demo/screens";
import { renderSitePage } from "./renderSitePage";

// Served by the dev server for scripts/zapstore-screenshots.ts; deliberately not a build input.
const screen = new URLSearchParams(location.search).get("screen");
if (!isScreen(screen)) throw new Error(`Unknown demo screen: ${screen}`);

renderSitePage(
  <div style={{ position: "fixed", inset: 0 }}>
    <ScaledScreen>
      <DemoScreen screen={screen} />
    </ScaledScreen>
  </div>,
);
