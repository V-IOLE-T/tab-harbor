# Material Color Utilities

This directory ships a local classic-script bundle of `@material/material-color-utilities@0.4.0`, published by the Material project at https://github.com/material-foundation/material-color-utilities.

The upstream implementation is licensed under Apache-2.0. Its copyright and license notices are preserved at the end of `material-color-utilities.js`; the complete unmodified package license is in `material-color-utilities.LICENSE`. The wallpaper-to-token mapping is implemented separately in `../monet-theme.js`.

The bundle exposes `TabHarborMCU` and makes no remote requests. `../../tools/vendor-material-color-utilities.mjs` pins the npm tarball's SHA-512 integrity and esbuild 0.25.0. Run `node tools/vendor-material-color-utilities.mjs --check` from the repository root to verify the bundle and license reproduce byte-for-byte; omit `--check` to regenerate them. Build-time downloads are confined to temporary directories and cleaned up afterwards.
