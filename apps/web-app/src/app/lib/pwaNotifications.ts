interface ShowPwaNotificationParams {
  appTitle: string;
  body: string;
  tag?: string;
  title: string;
}

export const showPwaNotification = async ({
  appTitle,
  body,
  tag,
  title,
}: ShowPwaNotificationParams): Promise<void> => {
  // Best-effort: only notify when the app isn't currently visible.
  try {
    if (document.visibilityState === "visible") return;
  } catch {
    // ignore
  }

  if (!("Notification" in globalThis)) return;

  let permission = Notification.permission;
  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      return;
    }
  }
  if (permission !== "granted") return;

  const safeTitle = title.trim() || appTitle.trim();
  const safeBody = body.trim();
  const options: NotificationOptions = tag
    ? { body: safeBody, tag: tag }
    : { body: safeBody };

  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.ready.catch(() => null);
      if (reg) {
        await reg.showNotification(safeTitle, options);
        return;
      }
    }
  } catch {
    // ignore
  }

  try {
    // Fallback for browsers that allow direct notifications.
    new Notification(safeTitle, options);
  } catch {
    // ignore
  }
};
