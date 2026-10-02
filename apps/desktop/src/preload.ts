import { contextBridge, ipcRenderer, webFrame } from "electron";

// With the title bar hidden, the window buttons overlay the page's top inset.
const TITLE_BAR_HEIGHT_PX = 28;

contextBridge.exposeInMainWorld("linkyDesktop", {
  notify: (title: string, body: string) => {
    ipcRenderer.send("notify", title, body);
  },
});

webFrame.insertCSS(`html:root { --safe-area-top: ${TITLE_BAR_HEIGHT_PX}px; }`);

window.addEventListener("DOMContentLoaded", () => {
  const dragRegion = document.createElement("div");
  dragRegion.style.cssText = `position: fixed; inset: 0 0 auto 0; height: ${TITLE_BAR_HEIGHT_PX}px; z-index: 2147483647; -webkit-app-region: drag;`;
  document.body.append(dragRegion);
});
