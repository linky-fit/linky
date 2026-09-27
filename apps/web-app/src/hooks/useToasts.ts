import { useState, useCallback, useRef, useEffect } from "react";

const MAX_VISIBLE_TOASTS = 2;
const TOAST_DURATION_MS = 2500;
const ACTION_TOAST_DURATION_MS = 6000;

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  message: string;
  onClick?: () => void;
  action?: ToastAction;
}

export interface PushToastOptions {
  onClick?: () => void;
  action?: ToastAction;
}

export const useToasts = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastTimersRef = useRef<Map<string, number>>(new Map());

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timeoutId = toastTimersRef.current.get(id);
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
      toastTimersRef.current.delete(id);
    }
  }, []);

  const pushToast = useCallback(
    (message: string, options?: PushToastOptions) => {
      const text = message.trim();
      if (!text) return;

      const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
      setToasts((prev) => {
        const next = [
          ...prev,
          {
            id,
            message: text,
            ...(options?.onClick ? { onClick: options.onClick } : {}),
            ...(options?.action ? { action: options.action } : {}),
          },
        ];
        const removed = next.slice(
          0,
          Math.max(0, next.length - MAX_VISIBLE_TOASTS),
        );
        for (const toast of removed) {
          const timeoutId = toastTimersRef.current.get(toast.id);
          if (timeoutId !== undefined) {
            window.clearTimeout(timeoutId);
            toastTimersRef.current.delete(toast.id);
          }
        }
        return next.slice(-MAX_VISIBLE_TOASTS);
      });

      const timeoutId = window.setTimeout(
        () => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
          toastTimersRef.current.delete(id);
        },
        options?.action ? ACTION_TOAST_DURATION_MS : TOAST_DURATION_MS,
      );

      toastTimersRef.current.set(id, timeoutId);
    },
    [],
  );

  useEffect(() => {
    const toastTimers = toastTimersRef.current;
    return () => {
      for (const timeoutId of toastTimers.values()) {
        try {
          window.clearTimeout(timeoutId);
        } catch {
          // ignore
        }
      }
      toastTimers.clear();
    };
  }, []);

  return { dismissToast, toasts, pushToast };
};
