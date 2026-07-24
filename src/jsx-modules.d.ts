// The ported view (src/view/**) is faithful untyped JSX/JS (exact-parity copy of MergeCombat's
// React + Canvas FX). tsc does not typecheck it (allowJs is off); this ambient declaration lets the
// typed entry (main.tsx) + provider import those modules as `any`. Vite/esbuild still bundles them.
declare module '*.jsx';
