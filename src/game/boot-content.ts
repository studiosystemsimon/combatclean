// APP boot: initialise the content singleton C from the baked config bundle, synchronously, at module
// load. main.tsx imports this FIRST so C is ready before the view's data barrels (which read C at
// module-eval) or the provider evaluate. App-only — statically imports the virtual module, so it is
// never part of the headless graph (where the harness calls initContent(scannedBundle) instead).
import bundle from 'virtual:game-config';
import { initContent } from './content.ts';

initContent(bundle);
