import React from "react";
import type { Toast } from "../hooks/useToasts";

interface ToastNotificationsProps {
  dismissToast: (id: string) => void;
  toasts: Toast[];
}

export const ToastNotifications: React.FC<ToastNotificationsProps> = ({
  dismissToast,
  toasts,
}) => {
  return (
    <>
      {toasts.length ? (
        <div className="toast-container" aria-live="polite">
          {toasts.map((toast) => (
            <React.Fragment key={toast.id}>
              {toast.action ? (
                <div className="toast toast-with-action">
                  <span>{toast.message}</span>
                  <button
                    className="toast-action"
                    type="button"
                    onClick={() => {
                      dismissToast(toast.id);
                      toast.action?.onClick();
                    }}
                  >
                    {toast.action.label}
                  </button>
                </div>
              ) : toast.onClick ? (
                <button
                  className="toast toast-button"
                  type="button"
                  onClick={() => {
                    dismissToast(toast.id);
                    toast.onClick?.();
                  }}
                >
                  {toast.message}
                </button>
              ) : (
                <div className="toast">{toast.message}</div>
              )}
            </React.Fragment>
          ))}
        </div>
      ) : null}
    </>
  );
};
