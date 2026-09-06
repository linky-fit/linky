import type { HTMLAttributes, ReactNode } from "react";

interface ModalSheetProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  sheetClassName?: string;
}

export function ModalSheet({
  children,
  sheetClassName = "modal-sheet",
  className = "modal-overlay",
  ...props
}: ModalSheetProps) {
  return (
    <div className={className} role="dialog" aria-modal="true" {...props}>
      <div
        className={sheetClassName}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
