# Wallpaper colors, materials and video backgrounds

Desk settings → Appearance keeps the existing Paper, Sage, Mist and Blush palettes and light/dark/system modes. Background, color source and material are independent choices. Quick-link opening mode and automatic/4/5-column layouts still work as before.

## Choose a background and colors

Choose None, Image or Video. Uploading an image selects Image; uploading a video selects Video only after decoding and durable local storage succeed. Switching away from an image keeps it available for later use.

Choose the preset color source to use the original palettes, or wallpaper colors to generate coordinated light and dark colors from the image or video poster. Switching between stored images and videos samples the selected source again and resets the seed hue to that source's extracted hue. The seed hue slider adjusts that palette; it saves as you move it. With no readable wallpaper, the saved preset remains the fallback. Clear becomes available immediately after an upload and becomes disabled again when that media is removed.

Color extraction runs locally using the bundled Material Color Utilities quantizer, scoring and HCT implementation. It samples at most 64 × 64 pixels and stores both tone maps. Startup, popup and other open dashboard pages use the same validated cache and glass tokens; the popup does not load a video player or run extraction.

Default preserves the original material. Frosted and Clear expose an intensity slider that saves on input. Clear uses **0 px blur and 100% saturation** throughout its 0–100 strength range. Its content scale is `1 - strength × 0.009`; both the selected surface depth and the cards' extra fill are scaled, without a 26% content floor. At the default surface depth of 14%, mission-card opacity is **82% / 45.1% / 8.2%** at strength **0 / 50 / 100**; saved-session cards use **84% / 46.2% / 8.4%**. These are final Chrome computed background alpha values in both light and dark mode.

**Frosted** does keep blur, and its shape is fixed in Chrome-observed terms: blur is **1 / 17 / 33 px** at strength **0 / 50 / 100** (about `1 + 0.32i`, rounded), and the surface fill runs **45% / 60% / 75%**. Both increase strictly across the whole range in both tones. The 0-strength fill is deliberately a *legibility floor*, not a "thin glass" marketing look: body text has to stay readable over a busy wallpaper, and opaque text does not count as readable on its own if the panel behind it is nearly see-through. The 100-strength value stops at 75% so the wallpaper and the blur remain visible instead of turning into an opaque panel — in dark mode the appearance menu and drawer used to be painted at a full 100% fill, which hid the blur completely and made "frosted" indistinguishable from opaque. Surface depth still shifts the fill, but that shift is bounded to ±2 points, so no depth can seal the surface or drop below the floor.

Search and content cards use `--glass-content-filter`, and nested cards inside the drawer reset it to `none`, so one drawer does not stack a second blur on top of the shell. Text opacity stays 100% on every frosted surface.

The 45% floor is a large improvement over the old 24–48% range but it is **not** a WCAG guarantee against every wallpaper. Blending the real tokens (`--ink`/`--card-bg` per tone) against the brightest and darkest wallpaper pixels gives these worst-case body-text contrasts:

| Fill | Strength | Light worst case | Dark worst case |
| --- | --- | --- | --- |
| 45% | 0 | 3.73:1 | 2.18:1 |
| 60% | 50 | 6.22:1 | 3.39:1 |
| 75% | 100 | 9.66:1 | 5.58:1 |

A 45% dark panel over a near-white wallpaper region still lands around 2.2:1, because the dark card colour blended 45/55 with white is mid-grey. Raising strength, or the independent wallpaper overlay, is the way to reach 4.5:1 in that case; the overlay is the better lever because it also helps text drawn directly on the wallpaper.

Because blur needs high-frequency detail to show, a flat or evenly-toned wallpaper naturally shows little visible blur even though the filter is applied. Increase wallpaper detail, raise the strength, or rely on the fill and the independent overlay in that case.

Menus, search, drawer, suggestions, popovers and editor fills follow the same clear strength through `--glass-control-scale = 1 - strength × 0.009`. Both the minimum and added fill are scaled; two-color fills scale their resulting alpha instead of mixing back to opaque. Text and element opacity stay at 100%, and fine borders remain. Default/frosted materials reset the control scale to 1. Browsers without backdrop filtering keep the existing more opaque fallback.

With surface depth 14 and overlay 0, Chrome computes these background alphas at clear strength **19 / 100**:

| Component | Light | Dark |
| --- | --- | --- |
| Appearance menu / drawer shell | .61346 / .074 | .829 / .1 |
| Header search | .72952 / .088 | .61346 / .074 |
| Suggestions / shortcut editor / tab picker | .61346 / .074 | .61346 / .074 |
| Shortcut and todo inputs (own fill) | .72952 / .088 | .72952 / .088 |
| Todo editor form (own fill) | .829 / .1 | .829 / .1 |

At 100, the nested todo input plus form and drawer composite is .23994 light / .26128 dark; nested backgrounds no longer obscure the wallpaper. These composite values describe background alpha, excluding text, borders and shadows.

**Wallpaper overlay** is a separate 0–100 slider that saves on input through the same serial preference queue. Zero removes the overlay, 100 fully covers the wallpaper. One fixed layer sits above the image/video/poster and below content. Changing it never changes glass opacity; changing glass never changes the saved overlay. No second image gradient or material-controlled dark scrim is applied. Selecting None hides the overlay while retaining its setting.

Old configurations without `wallpaperOverlay` combine the old image paper wash and material scrim once. The internal `wallpaperOverlayTint` (0–100 paper share) retains their composite color, including the previous half-strength dark scrim; system mode uses the current OS tone during migration. Overlay opacity is rounded to integer percent, so this preserves the previous background approximately. The tint is retained in settings and JSON backups but adds no new control. Migrated settings remain independent when strength, tone or media changes. Fresh explicit overlays use black unless a migrated tint is retained. Startup caches both fields, and popup/dashboard read the same shared math.

## Video limits and playback

Videos must be nonempty, at most **60 MiB**, at most **120 seconds**, and no more than **3840 pixels** on either edge. The browser must be able to decode the file: MP4, WebM, Ogg and MOV support depends on its codecs, so a file extension alone cannot guarantee playback.

The player is muted, loops and fills the background. Switching to an image clears the video element's old poster and hides it, so the selected image cannot be covered by stale video content. Pause/play is saved. Hidden pages pause and resume only when playback is enabled. Reduced-motion preferences show the static poster and prevent autoplay. Decode errors leave the poster visible. Import probes time out after 15 seconds; poster capture is WebP with a maximum edge of 960 pixels.

The video blob is stored in this extension's IndexedDB, separately from preferences in `chrome.storage.local`. Each import gets a unique resource ID. Playback requires that exact ID, matching size and saved timestamp; a missing identity never falls back to another local video. Failed decoding, quota errors and failed preference writes preserve the previous active media. Object URLs are revoked when sources change or the player is removed.

Removing extension data or uninstalling the extension removes local videos. Storage remains subject to the browser's available disk/quota. Failed cleanup may leave unused staged blobs; they cannot be selected by a backup without a local identity.

## Backups and restoring

Configuration JSON carries video **descriptive metadata and the poster**, plus the theme cache and playback preference. It does **not** carry the video binary, blob URL or device-local resource ID. Import also strips IDs from older backups, including when restoring on the original machine.

After import, the poster remains visible and a missing-media notice asks you to upload the video again. The backup's Video selection is retained so its recovery controls remain available. Without a poster, the preset background remains visible. Re-uploading the file creates a new local identity and restores motion; restoring a backup never silently substitutes the device's current video.

## 中文使用说明

在「桌面设置 → 外观」里分别选择背景、颜色来源和材质。图片上传后自动选择图片背景；视频在解码和本地保存成功后才启用。原有主题、明暗/系统模式和快捷链接设置保持可用。选择壁纸取色后，种子色相滑杆可调整配色；切换已保存的图片和视频时会重新提取对应配色，并重置到该背景的提取色相。上传后即可清除对应媒体，无需刷新。磨砂、清透材质的强度滑杆也会边拖边保存。清透材质始终无模糊，强度越高，卡片、外观面板、搜索框、抽屉和弹层背景一起变透明；文字不随背景淡出，细边框保留。新增「壁纸遮罩」0–100 滑杆，图片、视频及海报共用一层，遮罩和玻璃强度互不影响。旧配置会合并原来的纸色洗层与材质遮罩，迁移后独立保存；首屏缓存、弹出页和 JSON 备份均保留遮罩与迁移色调。壁纸取色完全在本地运行，首屏、弹出页和多个工作台共用缓存配色。

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

This requires Node with built-in WebSocket support (Node 22+), `google-chrome` with CDP `Extensions.loadUnpacked` support and `ffmpeg` with libvpx. Set `CHROME_BIN` to override the browser executable. It covers actual upload, immediate Clear availability and clearing, image/video palette switching, IDB reload, preference-write failure, all appearance sliders, final computed card alpha at 0/50/100 and visible control/ancestor alpha at 19/100, independent image/video overlay, cached first-paint equality, old JSON migration, local Monet, light/dark and multi-page/popup synchronization, reduced motion and backup isolation, and fails on runtime exceptions. Player hidden-state behavior and transaction quota-abort behavior are also tested with deterministic event-driven doubles; the gate does not simulate an OS disk-full condition or every supported video codec.

The local pass ran **626 tests: 626 passed, zero failed/skipped**, plus Chrome **156.0.8078.79** with zero runtime exceptions. The browser gate measures 12 production components in their visible states in light/dark mode at strength 19/100, including open drawers, editors and the tab-picker popover. It also verifies opaque text, 0 blur, composite ancestor fills, shared popup/multi-page tokens and cache-before-runtime equality. No synthetic content card is used for the visual comparison.

The gate always captures four 1280 × 900 empty-dashboard scenes using the same deterministic, nonprivate checkerboard image, at overlay 0 and strength 19/100. Set `WALLPAPER_SCREENSHOT_DIR` to retain them for visual inspection; otherwise captures, profile and generated media are removed with the temporary directory. A same-position pixel check excludes the part of search overlapped by the menu and asserts mean RGB difference above 12/255 for both the appearance panel and header search. The measured differences were approximately **62.21 / 61.33** in light mode and **63.65 / 49.00** in dark mode (panel / search). Small differences between runs can arise from font/paint timing.

The frosted gate is a separate behavior contract and deliberately does **not** restate the production fill formula. It drives the real appearance controls on a high-frequency wallpaper in light and dark mode at strength 0/50/100 and asserts only observable behavior: computed `backdrop-filter` is not `none`, blur strictly increases 0 < 50 < 100, and both computed fill and same-position pixel difference increase monotonically and clear the same 12/255 visibility bar used above. Text stays opaque, element opacity stays 1, and geometry is compared across strengths to prove the layout did not move. Fonts, data and animations settle before each capture, and nested drawer cards are measured while the drawer is actually open. A failing assertion prints the complete measured table plus every pixel difference before it throws. Switching back to Clear is verified to reset the frosted override.

This gate measured identical fill and blur in both tones: **0.450 / 0.600 / 0.750** fill with **1 / 17 / 33 px** blur at strength 0 / 50 / 100. Visual inspection of the 12 captures confirms the drawer and menu stay see-through at 100, so dark mode no longer hides the blur. Blur needs high-frequency detail: on an evenly toned wallpaper the filter still applies but the blur is naturally not visible, so that pass checks the filter, fill and independent overlay instead of pixel differences.

Visual inspection of all four clear captures confirms clear wallpaper transmission through the settings panel and search at 100. High-frequency wallpaper competes with fine text at maximum transparency, despite opaque text; increase the independent overlay or reduce clear strength for easier reading. This is not a contrast guarantee for arbitrary images. The comparison does not establish mobile layout coverage, every video codec, or a full contrast matrix. Video upload, poster cleanup, overlay and palette switching remain covered separately by the gate.

The vendored dependency is **@material/material-color-utilities 0.4.0**, under **Apache-2.0**. The package tarball's SHA-512 is pinned in the build script; esbuild is pinned to **0.25.0**. Upstream legal comments remain in the generated bundle and the complete upstream license ships beside it. Rebuild and verify both files byte-for-byte:

```sh
node tools/vendor-material-color-utilities.mjs
node tools/vendor-material-color-utilities.mjs --check
```

These developer commands require npm registry access; extension use and color extraction do not require a network connection. See [vendor attribution](../extension/vendor/README.md), [build script](../tools/vendor-material-color-utilities.mjs) and [license](../extension/vendor/material-color-utilities.LICENSE).
