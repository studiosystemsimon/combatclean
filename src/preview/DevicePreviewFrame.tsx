import { useState, useRef, useEffect, useCallback } from "react";
import type { Device } from "./devices";
import { DEFAULT_DEVICES } from "./devices";

export interface CssVarNames {
  maxWidth: string;
  safeTop: string;
  safeBottom: string;
  safeLeft: string;
  safeRight: string;
}

const DEFAULT_CSS_VAR_NAMES: CssVarNames = {
  maxWidth: "--app-max-width",
  safeTop: "--safe-top",
  safeBottom: "--safe-bottom",
  safeLeft: "--safe-left",
  safeRight: "--safe-right",
};

export interface DevicePreviewFrameProps {
  /** URL loaded into the framed iframe. Defaults to the current page's origin. */
  src?: string;
  /** Device presets to offer in the picker. Defaults to a built-in iOS + Android list. */
  devices?: Device[];
  /** Device name (must match one of `devices`) selected on first mount, before any saved prefs are read. */
  defaultDeviceName?: string;
  /** localStorage key used to persist the selected device + safe-area toggle. Pass `false` to disable persistence. */
  prefsKey?: string | false;
  /**
   * CSS custom property names written into the framed iframe's `:root` so the embedded
   * app can size itself to the simulated device and its safe-area insets (e.g. via
   * `env()`-backed variables in the host app's stylesheet). Pass `false` to skip CSS
   * injection entirely (only the visual safe-area overlay bands will still render).
   */
  cssVarNames?: CssVarNames | false;
  /** Accessible title for the framed iframe. */
  iframeTitle?: string;
}

function loadPrefs(prefsKey: string | false): { deviceName: string; safeAreaOn: boolean } | null {
  if (!prefsKey) return null;
  try {
    const raw = localStorage.getItem(prefsKey);
    return raw ? (JSON.parse(raw) as { deviceName: string; safeAreaOn: boolean }) : null;
  } catch {
    return null;
  }
}

function savePrefs(prefsKey: string | false, deviceName: string, safeAreaOn: boolean) {
  if (!prefsKey) return;
  try {
    localStorage.setItem(prefsKey, JSON.stringify({ deviceName, safeAreaOn }));
  } catch {
    // ignore storage failures (private browsing, quota, etc.)
  }
}

function useViewportSize() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const handle = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", handle);
    return () => window.removeEventListener("resize", handle);
  }, []);
  return size;
}

const BEZEL_V = 24; // top/bottom phone body padding in px (at 1x)
const BEZEL_H = 14; // left/right phone body padding
const CONTROLS_H = 44;
const MARGIN = 12;

export function DevicePreviewFrame({
  src,
  devices = DEFAULT_DEVICES,
  defaultDeviceName,
  prefsKey = "device-preview-frame:prefs",
  cssVarNames = DEFAULT_CSS_VAR_NAMES,
  iframeTitle = "Device Preview",
}: DevicePreviewFrameProps) {
  const resolveInitialDevice = useCallback((): Device => {
    const prefs = loadPrefs(prefsKey);
    if (prefs) {
      const saved = devices.find((d) => d.name === prefs.deviceName);
      if (saved) return saved;
    }
    if (defaultDeviceName) {
      const found = devices.find((d) => d.name === defaultDeviceName);
      if (found) return found;
    }
    return devices[0];
    // Only ever consulted on first mount; changing props later doesn't reset selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [device, setDevice] = useState<Device>(resolveInitialDevice);
  const [safeAreaOn, setSafeAreaOn] = useState<boolean>(() => loadPrefs(prefsKey)?.safeAreaOn ?? false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { w: vw, h: vh } = useViewportSize();

  // Scale so the whole device frame fits inside the viewport with room for controls
  const frameW = device.width + BEZEL_H * 2;
  const frameH = device.height + BEZEL_V * 2;
  const scaleW = (vw - MARGIN * 2) / frameW;
  const scaleH = (vh - CONTROLS_H - MARGIN * 2) / frameH;
  const scale = Math.min(scaleW, scaleH, 1); // never upscale

  // Inject / remove safe-area CSS custom props into the same-origin iframe
  const applyToIframe = useCallback(() => {
    if (!cssVarNames) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    try {
      const doc = iframe.contentDocument;
      if (!doc?.head) return;
      let el = doc.getElementById("__device-preview-frame-safe") as HTMLStyleElement | null;
      if (!el) {
        el = doc.createElement("style");
        el.id = "__device-preview-frame-safe";
        doc.head.appendChild(el);
      }
      // Always set the max-width var so the embedded app fills the simulated device width.
      el.textContent = `:root {
          ${cssVarNames.maxWidth}: ${device.width}px;
          ${safeAreaOn
            ? `${cssVarNames.safeTop}: ${device.safeTop}px;
          ${cssVarNames.safeBottom}: ${device.safeBottom}px;
          ${cssVarNames.safeLeft}: 0px;
          ${cssVarNames.safeRight}: 0px;`
            : ""}
        }`;
    } catch {
      // cross-origin guard — shouldn't happen for a same-origin preview target
    }
  }, [safeAreaOn, device, cssVarNames]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    iframe.addEventListener("load", applyToIframe);
    applyToIframe();
    return () => iframe.removeEventListener("load", applyToIframe);
  }, [applyToIframe]);

  const scaledW = frameW * scale;
  const scaledH = frameH * scale;
  const resolvedSrc = src ?? window.location.origin;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#080810",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        padding: `${MARGIN}px ${MARGIN}px ${MARGIN}px`,
        boxSizing: "border-box",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {/* Controls bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
          flexWrap: "wrap",
          justifyContent: "center",
          height: CONTROLS_H - 8,
        }}
      >
        <select
          value={device.name}
          onChange={(e) => {
            const found = devices.find((d) => d.name === e.target.value);
            if (found) { setDevice(found); savePrefs(prefsKey, found.name, safeAreaOn); }
          }}
          style={{
            padding: "5px 10px",
            borderRadius: 6,
            background: "#1a1a2e",
            color: "#cdd6f4",
            border: "1px solid #2d2d4a",
            fontSize: 13,
            cursor: "pointer",
            outline: "none",
          }}
        >
          <optgroup label="iOS">
            {devices.filter((d) => d.platform === "ios").map((d) => (
              <option key={d.name}>{d.name}</option>
            ))}
          </optgroup>
          <optgroup label="Android">
            {devices.filter((d) => d.platform === "android").map((d) => (
              <option key={d.name}>{d.name}</option>
            ))}
          </optgroup>
        </select>

        <span style={{ color: "#555577", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
          {device.width} × {device.height}
        </span>

        <button
          onClick={() => setSafeAreaOn((v) => { savePrefs(prefsKey, device.name, !v); return !v; })}
          style={{
            padding: "5px 12px",
            borderRadius: 6,
            border: `1px solid ${safeAreaOn ? "#f38ba8" : "#2d2d4a"}`,
            background: safeAreaOn ? "rgba(243,139,168,0.15)" : "#1a1a2e",
            color: safeAreaOn ? "#f38ba8" : "#888aaa",
            fontSize: 13,
            cursor: "pointer",
            transition: "all 0.15s",
            outline: "none",
          }}
        >
          {safeAreaOn ? "● Safe Area ON" : "○ Safe Area OFF"}
        </button>
      </div>

      {/* Scaled device frame container — reserves exact scaled space */}
      <div style={{ width: scaledW, height: scaledH, position: "relative", flexShrink: 0 }}>
        <div
          style={{
            width: frameW,
            height: frameH,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            position: "absolute",
            top: 0,
            left: 0,
          }}
        >
          {/* Phone body */}
          <div
            style={{
              width: frameW,
              height: frameH,
              background: "linear-gradient(145deg, #222238 0%, #141420 100%)",
              borderRadius: device.cornerRadius + 12,
              boxShadow: [
                "0 0 0 1px rgba(255,255,255,0.07)",
                "0 0 0 2px rgba(0,0,0,0.8)",
                "0 40px 120px rgba(0,0,0,0.9)",
                "inset 0 1px 0 rgba(255,255,255,0.05)",
              ].join(", "),
              padding: `${BEZEL_V}px ${BEZEL_H}px`,
              boxSizing: "border-box",
              position: "relative",
            }}
          >
            {/* Side buttons (decorative) */}
            <div style={{ position: "absolute", right: -3, top: 120, width: 3, height: 60, background: "#1a1a30", borderRadius: "0 2px 2px 0" }} />
            <div style={{ position: "absolute", left: -3, top: 100, width: 3, height: 36, background: "#1a1a30", borderRadius: "2px 0 0 2px" }} />
            <div style={{ position: "absolute", left: -3, top: 150, width: 3, height: 44, background: "#1a1a30", borderRadius: "2px 0 0 2px" }} />
            <div style={{ position: "absolute", left: -3, top: 208, width: 3, height: 44, background: "#1a1a30", borderRadius: "2px 0 0 2px" }} />

            {/* Screen area */}
            <div
              style={{
                width: device.width,
                height: device.height,
                borderRadius: device.cornerRadius,
                overflow: "hidden",
                background: "#000",
                position: "relative",
              }}
            >
              {/* Dynamic Island */}
              {device.hasDynamicIsland && (
                <div
                  style={{
                    position: "absolute",
                    top: 14,
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: 120,
                    height: 36,
                    background: "#000",
                    borderRadius: 20,
                    zIndex: 10,
                    pointerEvents: "none",
                  }}
                />
              )}

              {/* Notch */}
              {device.hasNotch && (
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: 160,
                    height: 30,
                    background: "#000",
                    borderRadius: "0 0 20px 20px",
                    zIndex: 10,
                    pointerEvents: "none",
                  }}
                />
              )}

              <iframe
                ref={iframeRef}
                src={resolvedSrc}
                width={device.width}
                height={device.height}
                style={{ border: "none", display: "block" }}
                title={iframeTitle}
              />

              {/* Safe-area overlays (purely visual, pointer-events:none) */}
              {safeAreaOn && device.safeTop > 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: device.safeTop,
                    background: "transparent",
                    borderBottom: "2px dashed rgba(80, 250, 130, 0.9)",
                    pointerEvents: "none",
                    zIndex: 20,
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "center",
                    paddingBottom: 2,
                  }}
                >
                  <span style={{ fontSize: 10, color: "rgba(80,250,130,0.9)", fontWeight: 600, letterSpacing: 0.5 }}>
                    SAFE TOP {device.safeTop}px
                  </span>
                </div>
              )}
              {safeAreaOn && device.safeBottom > 0 && (
                <div
                  style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: device.safeBottom,
                    background: "transparent",
                    borderTop: "2px dashed rgba(80, 250, 130, 0.9)",
                    pointerEvents: "none",
                    zIndex: 20,
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "center",
                    paddingTop: 2,
                  }}
                >
                  <span style={{ fontSize: 10, color: "rgba(80,250,130,0.9)", fontWeight: 600, letterSpacing: 0.5 }}>
                    SAFE BOTTOM {device.safeBottom}px
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
