# preview — dev-only device-frame preview

Wraps the whole page in a phone/tablet bezel with a device picker and a safe-area
overlay, so you can eyeball the game at real device dimensions without a physical
device or emulator. Ported from the standalone `device-preview-frame` package as
in-repo source (not a dependency) specifically so it's yours to customize after the
game is generated — a package can't be edited, this can.

## How it's wired

`src/main.ts` mounts it behind a guard:

```ts
if (import.meta.env.DEV && window.self === window.top) {
  import('./preview').then(({ mountDevicePreview }) => mountDevicePreview());
}
```

- `import.meta.env.DEV` — dev-server only; Vite dead-code-eliminates this whole branch
  from production builds (`npm run build`), so none of this ships to players.
- `window.self === window.top` — the component works by loading the page itself in an
  `<iframe>`; this guard stops that iframe from mounting a second preview inside itself
  (infinite recursion).

`mountDevicePreview()` (`mount.ts`) creates a standalone `<div id="device-preview-root">`,
appends it to `document.body`, and mounts `<DevicePreviewFrame />` into it with its own
React root — independent of whatever `#ui-root` the game's real UI uses.

**Migration note:** once your game has a real `src/ui` React root (Phase 4, step 8 of
`SETUP.md`), you can fold this in there instead — wrap the top-level `<App/>` render with
the same `import.meta.env.DEV` + `window.self === window.top` guard around
`<DevicePreviewFrame><App/></DevicePreviewFrame>`, and delete `mount.ts` and the call in
`main.ts`. Not required; both approaches work, this just avoids a second React root once
you have one anyway.

## Customizing

There's no theme-prop or CSS-variable indirection for the frame's own chrome (bezel
color, controls bar, accent color) — it's plain inline styles in
`DevicePreviewFrame.tsx`. Edit it directly; it's your code now.

What's already prop-configurable, passed via `mountDevicePreview()`/`<DevicePreviewFrame>`:

| Prop | Default | Purpose |
|---|---|---|
| `src` | `window.location.origin` | URL loaded into the framed iframe |
| `devices` | `DEFAULT_DEVICES` (`devices.ts`) | device presets offered in the picker |
| `defaultDeviceName` | first entry in `devices` | initial selection, before any saved prefs |
| `prefsKey` | `"device-preview-frame:prefs"` | localStorage key for the selected device + safe-area toggle; `false` disables persistence |
| `cssVarNames` | `{maxWidth, safeTop, safeBottom, safeLeft, safeRight}` (`--app-max-width` etc.) | CSS custom property names injected into the framed iframe's `:root`; `false` disables injection (overlay bands still render) |
| `iframeTitle` | `"Device Preview"` | accessible title for the framed iframe |

Add/remove device presets by editing `DEFAULT_DEVICES` in `devices.ts`, or pass a custom
`devices` array to `mountDevicePreview` via `DevicePreviewFrame` directly if you fork
`mount.ts`.

## Invariants

- Not gated by DI/signals — this is dev tooling, not a game module. It never touches
  `world.bus`, the composition root, or `src/data`.
- Must never be reachable from a production build. If you change the mount site, keep it
  behind an `import.meta.env.DEV` check.
