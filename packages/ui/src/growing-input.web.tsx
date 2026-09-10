import { useLayoutEffect, useRef } from "react";
import { Input } from "tamagui";
import type { GrowingInputProps } from "./growing-input";

export function GrowingInput({
  value,
  minHeight,
  maxHeight,
  ...props
}: GrowingInputProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const input = ref.current;
    if (!input) return;
    const resize = () => {
      input.style.height = "auto";
      input.style.height = `${Math.min(maxHeight ?? Infinity, Math.max(minHeight, input.scrollHeight))}px`;
    };
    let width = input.clientWidth;
    resize();
    const observer = new ResizeObserver(() => {
      if (input.clientWidth !== width) {
        width = input.clientWidth;
        resize();
      }
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [value, minHeight, maxHeight]);
  return (
    <Input
      {...props}
      ref={(node) => {
        ref.current = node instanceof HTMLTextAreaElement ? node : null;
      }}
      value={value}
      render="textarea"
      rows={1}
      minHeight={minHeight}
      style={{
        resize: "none",
        overflowY: maxHeight === undefined ? "hidden" : "auto",
      }}
    />
  );
}
