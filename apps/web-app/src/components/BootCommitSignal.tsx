import React from "react";

interface BootCommitSignalProps {
  onCommit: () => void;
}

interface BootLoadingFallbackProps {
  onSuspend: () => void;
}

export const BootCommitSignal = ({ onCommit }: BootCommitSignalProps) => {
  React.useLayoutEffect(() => {
    onCommit();
  }, [onCommit]);

  return null;
};

export const BootLoadingFallback = ({
  onSuspend,
}: BootLoadingFallbackProps) => {
  React.useLayoutEffect(() => {
    onSuspend();
  }, [onSuspend]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#020617",
        color: "#f9fbfc",
        fontFamily:
          "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      <div style={{ display: "grid", placeItems: "center", gap: 16 }}>
        <img
          src="/icon-animated.svg"
          alt="Linky"
          width="220"
          height="220"
          style={{ display: "block" }}
        />
        <div style={{ fontSize: 14, opacity: 0.85 }}>Loading…</div>
      </div>
    </div>
  );
};
