import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  shell,
  session,
  Tray,
} from "electron";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type AvailableUpdate,
  fetchAvailableUpdate,
  watchForUpdates,
} from "./updater";

const appUrl = new URL(
  process.env.LINKY_DESKTOP_URL ?? "https://app.linky.fit",
);
const externalProtocols = new Set([
  "http:",
  "https:",
  "mailto:",
  "lightning:",
  "bitcoin:",
  "cashu:",
  "nostr:",
]);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let availableUpdate: AvailableUpdate | null = null;
// Electron drops click handlers of garbage-collected notifications.
const shownNotifications = new Set<Notification>();

const showWindow = () => {
  mainWindow ??= createWindow();
  void app.dock?.show();
  mainWindow.show();
  mainWindow.focus();
};

const hideWindow = () => {
  mainWindow?.hide();
  app.dock?.hide();
};

const openExternally = (url: string) => {
  if (externalProtocols.has(new URL(url).protocol)) {
    void shell.openExternal(url);
  }
};

const createWindow = () => {
  const window = new BrowserWindow({
    width: 440,
    height: 900,
    minWidth: 360,
    minHeight: 600,
    show: false,
    title: "Linky",
    titleBarStyle: "hidden",
    backgroundColor: "#0b1222",
    webPreferences: {
      preload: path.join(app.getAppPath(), "dist", "preload.cjs"),
      // Hidden in the tray, the page must keep its relay subscriptions alive.
      backgroundThrottling: false,
    },
  });

  window.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    hideWindow();
  });
  // A renderer-initiated window.close() destroys the window without "close".
  window.on("closed", () => {
    mainWindow = null;
    app.dock?.hide();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin === appUrl.origin) return;
    event.preventDefault();
    openExternally(url);
  });

  void window.loadURL(appUrl.href);
  return window;
};

const downloadUpdate = ({ downloadUrl }: AvailableUpdate) => {
  void shell.openExternal(downloadUrl);
};

const offerUpdate = (update: AvailableUpdate) => {
  availableUpdate = update;
  refreshTrayMenu();
  notify(
    `Linky ${update.version} is available`,
    "Click to download it, then replace Linky in Applications.",
    () => downloadUpdate(update),
  );
};

const checkForUpdatesManually = async () => {
  try {
    const update = await fetchAvailableUpdate();
    if (update) {
      offerUpdate(update);
      return;
    }
    await dialog.showMessageBox({
      message: `Linky ${app.getVersion()} is the latest version.`,
    });
  } catch (error) {
    await dialog.showMessageBox({
      type: "error",
      message: "Could not check for updates.",
      detail: String(error),
    });
  }
};

const updateMenuItem = (): Electron.MenuItemConstructorOptions => {
  const update = availableUpdate;
  return update
    ? {
        label: `Download Linky ${update.version}`,
        click: () => downloadUpdate(update),
      }
    : {
        label: "Check for updates…",
        click: () => void checkForUpdatesManually(),
      };
};

const refreshTrayMenu = () => {
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Linky ${app.getVersion()} (beta)`, enabled: false },
      { type: "separator" },
      { label: "Open Linky", click: showWindow },
      updateMenuItem(),
      { type: "separator" },
      {
        label: "Open at login",
        type: "checkbox",
        checked: app.getLoginItemSettings().openAtLogin,
        click: ({ checked }) =>
          app.setLoginItemSettings({ openAtLogin: checked }),
      },
      { type: "separator" },
      { label: "Quit Linky", click: () => app.quit() },
    ]),
  );
};

const notify = (title: string, body: string, onClick: () => void) => {
  const notification = new Notification({ title, body });
  shownNotifications.add(notification);
  notification.on("click", onClick);
  notification.on("close", () => shownNotifications.delete(notification));
  notification.show();
};

// Notifications arrive only while Linky runs, so it starts at login unless the
// user opts out. Outside /Applications the path could be a translocated copy.
const enableOpenAtLoginOnFirstLaunch = () => {
  const marker = path.join(app.getPath("userData"), "open-at-login-defaulted");
  if (!app.isInApplicationsFolder() || existsSync(marker)) return;
  app.setLoginItemSettings({ openAtLogin: true });
  writeFileSync(marker, "");
};

const start = () => {
  enableOpenAtLoginOnFirstLaunch();

  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback, { requestingUrl }) => {
      callback(new URL(requestingUrl).origin === appUrl.origin);
    },
  );

  ipcMain.on("notify", (event, title: unknown, body: unknown) => {
    if (event.senderFrame?.origin !== appUrl.origin) return;
    if (typeof title !== "string" || typeof body !== "string") return;
    notify(title, body, showWindow);
  });

  mainWindow = createWindow();
  if (!app.getLoginItemSettings().wasOpenedAtLogin) showWindow();
  tray = new Tray(path.join(app.getAppPath(), "assets", "trayTemplate.png"));
  tray.setToolTip("Linky (beta)");
  refreshTrayMenu();

  watchForUpdates(offerUpdate);
};

if (app.requestSingleInstanceLock()) {
  app.on("second-instance", showWindow);
  app.on("activate", showWindow);
  app.on("before-quit", () => {
    isQuitting = true;
  });
  void app.whenReady().then(start);
} else {
  app.quit();
}
