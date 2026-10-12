import { Toast, ToastStack } from "@linky-fit/ui";
import React from "react";
import type { Toast as AppToast } from "../hooks/useToasts";

interface ToastNotificationsProps {
  dismissToast: (id: string) => void;
  toasts: readonly AppToast[];
}

export const ToastNotifications: React.FC<ToastNotificationsProps> = ({
  dismissToast,
  toasts,
}) => {
  if (!toasts.length) return null;

  const pressed = (id: string, run: () => void) => () => {
    dismissToast(id);
    run();
  };

  return (
    <ToastStack>
      {toasts.map(({ actions, id, message, onClick }) =>
        actions ? (
          <Toast
            key={id}
            title={message}
            actions={actions.map((action) => ({
              label: action.label,
              onPress: pressed(id, action.onClick),
            }))}
          />
        ) : onClick ? (
          <Toast key={id} title={message} onPress={pressed(id, onClick)} />
        ) : (
          <Toast key={id} title={message} />
        ),
      )}
    </ToastStack>
  );
};
