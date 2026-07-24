import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { DevicePreviewFrame } from "./DevicePreviewFrame";

/**
 * Mounts the device-frame preview over the whole page. Dev-only tooling — call this
 * from `main.ts` behind an `import.meta.env.DEV` + `window.self === window.top` guard
 * (see src/preview/README.md). Not meant to run in production builds.
 *
 * The preview iframes a fresh load of this same page to show the real app — so the
 * OUTER (top-window) copy of `#game-frame` must be hidden here, or its full-bleed
 * absolute positioning would paint over the preview's controls and bezel. The real
 * app keeps rendering normally *inside* the iframe, where `window.self !== window.top`
 * so this guard/hide never applies.
 */
export function mountDevicePreview(): void {
  const gameFrame = document.getElementById("game-frame");
  if (gameFrame) gameFrame.style.display = "none";

  const host = document.createElement("div");
  host.id = "device-preview-root";
  document.body.appendChild(host);
  createRoot(host).render(createElement(DevicePreviewFrame));
}
