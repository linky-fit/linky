import {
  Button,
  CodeBlock,
  Row,
  ScrollView,
  Stack,
  Text,
  UIProvider,
} from "@linky-fit/ui";
import React, { type ReactNode } from "react";
import { getInitialLang, translations } from "./i18n";
import { getColorMode } from "./utils/colorMode";
import { getThemePalette } from "./utils/themePalette";
import {
  downloadBootDiagnostics,
  formatBootError,
  recordBootError,
} from "./utils/bootDiagnostics";

interface ErrorBoundaryProps {
  children: ReactNode;
  onError?: () => void;
}

interface ErrorBoundaryState {
  error?: Error;
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    recordBootError(error, "react-error-boundary", info.componentStack);
    this.props.onError?.();
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.hasError) {
      const text = translations[getInitialLang()];
      return (
        <UIProvider mode={getColorMode()} palette={getThemePalette()}>
          <ScrollView height="100%">
            <Stack padding="$xxxl">
              <Text variant="heading">{text.appCrashed}</Text>
              <CodeBlock>{formatBootError(this.state.error)}</CodeBlock>
              <Row flexWrap="wrap" gap="$sm">
                <Button onPress={() => void downloadBootDiagnostics()}>
                  {text.downloadBootDiagnostics}
                </Button>
                <Button
                  variant="secondary"
                  onPress={() =>
                    window.dispatchEvent(
                      new Event("linky-clear-cache-and-reload"),
                    )
                  }
                >
                  {text.reloadApp}
                </Button>
              </Row>
            </Stack>
          </ScrollView>
        </UIProvider>
      );
    }

    return this.props.children;
  }
}
