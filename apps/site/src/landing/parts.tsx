import {
  Button,
  DeviceFrame,
  Image,
  Row,
  type DeviceFrameProps,
  type IconName,
} from "@linky-fit/ui";
import { themes } from "@linky-fit/ui/tokens";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSystemColorMode } from "../useSystemColorMode";
import { screenSrc, type CtaMode, type Screen } from "./copy";

const ctaModes: readonly CtaMode[] = [
  "web",
  "google-play",
  "android-apk",
  "zapstore",
];

const ctaIcons: Record<CtaMode, IconName> = {
  "android-apk": "Download",
  "google-play": "Play",
  web: "Monitor",
  zapstore: "Zap",
};

const ctaUrls: Record<CtaMode, string> = {
  "android-apk":
    "https://github.com/hynek-jina/linky/releases/latest/download/linky.apk",
  "google-play": "https://play.google.com/store/apps/details?id=fit.linky.app",
  web: "https://app.linky.fit",
  zapstore: "https://zapstore.dev/apps/fit.linky.app",
};

const defaultCtaMode = (): CtaMode => {
  const userAgent = navigator.userAgent.toLowerCase();
  return userAgent.includes("android") && userAgent.includes("mobile")
    ? "google-play"
    : "web";
};

const launchApp = (mode: CtaMode) => {
  if (mode === "google-play" && /android/i.test(navigator.userAgent)) {
    window.location.assign(
      `intent://play.google.com/store/apps/details?id=fit.linky.app#Intent;scheme=https;package=com.android.vending;S.browser_fallback_url=${encodeURIComponent(ctaUrls.web)};end`,
    );
    return;
  }
  window.open(ctaUrls[mode], "_blank", "noopener,noreferrer");
};

/** The recommended platform as the primary action, the others beside it. */
export function AppLaunch({
  labels,
  centered = false,
}: {
  labels: Record<CtaMode, string>;
  centered?: boolean;
}) {
  const [primary] = useState(defaultCtaMode);
  return (
    <Row
      gap="$sm"
      flexWrap="wrap"
      justifyContent={centered ? "center" : "flex-start"}
    >
      <Button
        icon="ArrowUpRight"
        paddingHorizontal="$xxl"
        onPress={() => launchApp(primary)}
      >
        {labels[primary]}
      </Button>
      {ctaModes
        .filter((mode) => mode !== primary)
        .map((mode) => (
          <Button
            key={mode}
            variant="secondary"
            icon={ctaIcons[mode]}
            onPress={() => launchApp(mode)}
          >
            {labels[mode]}
          </Button>
        ))}
    </Row>
  );
}

/** A soft pool of accent light behind the product. */
export function Glow({
  size,
  top,
  left,
}: {
  size: string;
  top: string;
  left: string;
}) {
  const mode = useSystemColorMode();
  return (
    <div
      aria-hidden
      className="landing-glow"
      style={{
        width: size,
        height: size,
        top,
        left,
        transform: "translate(-50%, -50%)",
        background: `radial-gradient(closest-side, ${themes[mode].accent}, transparent)`,
        opacity: mode === "dark" ? 0.32 : 0.22,
      }}
    />
  );
}

/** An app screenshot in a phone, matching the page's color mode. */
export function Phone({
  screen,
  ...props
}: Omit<DeviceFrameProps, "children"> & { screen: Screen }) {
  const mode = useSystemColorMode();
  return (
    <DeviceFrame {...props}>
      <Image
        src={screenSrc(screen, mode)}
        alt=""
        width="100%"
        height="100%"
        objectFit="cover"
      />
    </DeviceFrame>
  );
}

/** Fades its content in the first time it scrolls into view. */
export function Reveal({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setVisible(true);
        observer.disconnect();
      },
      { threshold: 0.15 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={visible ? "landing-reveal is-visible" : "landing-reveal"}
    >
      {children}
    </div>
  );
}
