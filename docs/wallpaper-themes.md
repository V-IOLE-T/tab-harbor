# Wallpaper colors, materials and video backgrounds

Desk settings → Appearance keeps the existing Paper, Sage, Mist and Blush palettes and light/dark/system modes. Background, color source and material are independent choices. Quick-link opening mode and automatic/4/5-column layouts still work as before.

## Choose a background and colors

Choose None, Image or Video. Uploading an image selects Image; uploading a video selects Video only after decoding and durable local storage succeed. Switching away from an image keeps it available for later use.

Choose the preset color source to use the original palettes, or wallpaper colors to generate coordinated light and dark colors from the image or video poster. The seed hue slider adjusts that palette; it saves as you move it. With no readable wallpaper, the saved preset remains the fallback.

Color extraction runs locally using the bundled Material Color Utilities quantizer, scoring and HCT implementation. It samples at most 64 × 64 pixels and stores both tone maps. Startup, popup and other open dashboard pages use the same validated cache and glass tokens; the popup does not load a video player or run extraction.

Default preserves the original material. Frosted and Clear expose an intensity slider that saves on input. Clear retains an opacity floor for readability; browsers without backdrop filtering use more opaque surfaces.

## Video limits and playback

Videos must be nonempty, at most **60 MiB**, at most **120 seconds**, and no more than **3840 pixels** on either edge. The browser must be able to decode the file: MP4, WebM, Ogg and MOV support depends on its codecs, so a file extension alone cannot guarantee playback.

The player is muted, loops and fills the background. Pause/play is saved. Hidden pages pause and resume only when playback is enabled. Reduced-motion preferences show the static poster and prevent autoplay. Decode errors leave the poster visible. Import probes time out after 15 seconds; poster capture is WebP with a maximum edge of 960 pixels.

The video blob is stored in this extension's IndexedDB, separately from preferences in `chrome.storage.local`. Each import gets a unique resource ID. Playback requires that exact ID, matching size and saved timestamp; a missing identity never falls back to another local video. Failed decoding, quota errors and failed preference writes preserve the previous active media. Object URLs are revoked when sources change or the player is removed.

Removing extension data or uninstalling the extension removes local videos. Storage remains subject to the browser's available disk/quota. Failed cleanup may leave unused staged blobs; they cannot be selected by a backup without a local identity.

## Backups and restoring

Configuration JSON carries video **descriptive metadata and the poster**, plus the theme cache and playback preference. It does **not** carry the video binary, blob URL or device-local resource ID. Import also strips IDs from older backups, including when restoring on the original machine.

After import, the poster remains visible and a missing-media notice asks you to upload the video again. The backup's Video selection is retained so its recovery controls remain available. Without a poster, the preset background remains visible. Re-uploading the file creates a new local identity and restores motion; restoring a backup never silently substitutes the device's current video.

## 中文使用说明

在「桌面设置 → 外观」里分别选择背景、颜色来源和材质。图片上传后自动选择图片背景；视频在解码和本地保存成功后才启用。原有主题、明暗/系统模式和快捷链接设置保持可用。选择壁纸取色后，种子色相滑杆可调整配色；磨砂、清透材质的强度滑杆也会边拖边保存。壁纸取色完全在本地运行，首屏、弹出页和多个工作台共用缓存配色。

视频上限为 60 MiB、120 秒、最长边 3840 像素，能否播放还取决于浏览器解码器。视频静音循环，页面隐藏时暂停；系统要求减少动态效果时只显示海报。解码或保存失败会保留原来的媒体。

备份只带视频元数据、海报和配色缓存，不带视频文件和本机资源 ID。导入后显示海报并提示重新上传；即使本机已有其他视频，也不会误播。卸载扩展或清除扩展数据会移除本地视频。

## Verification and third-party source

Run the complete Node regression suite:

```sh
node --test extension/*.test.js extension/popup/*.test.js
```

The five modules have direct tests covering material math/cache validation, real MCU output and text contrast, transaction commit/abort safety, player lifecycle, source identity and asynchronous runtime replacement. Additional tests cover backup isolation and cached first paint. The browser gate exercises the actual extension and file-input handlers in a fresh Chrome profile:

```sh
node tools/verify-wallpaper-browser.mjs
```

This requires Node with built-in WebSocket support (Node 22+), `google-chrome` with CDP `Extensions.loadUnpacked` support and `ffmpeg` with libvpx. Set `CHROME_BIN` to override the browser executable. It covers actual upload and IDB reload, preference-write failure, both sliders, local Monet, light/dark and multi-page/popup synchronization, reduced motion, backup isolation and image upload, and fails on runtime exceptions. Player hidden-state behavior and transaction quota-abort behavior are also tested with deterministic event-driven doubles; the gate does not simulate an OS disk-full condition or every supported video codec.

The vendored dependency is **@material/material-color-utilities 0.4.0**, under **Apache-2.0**. The package tarball's SHA-512 is pinned in the build script; esbuild is pinned to **0.25.0**. Upstream legal comments remain in the generated bundle and the complete upstream license ships beside it. Rebuild and verify both files byte-for-byte:

```sh
node tools/vendor-material-color-utilities.mjs
node tools/vendor-material-color-utilities.mjs --check
```

These developer commands require npm registry access; extension use and color extraction do not require a network connection. See [vendor attribution](../extension/vendor/README.md), [build script](../tools/vendor-material-color-utilities.mjs) and [license](../extension/vendor/material-color-utilities.LICENSE).
