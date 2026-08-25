# Privacy Policy for Tab Harbor

Last updated: 2026-08-25

Tab Harbor is a Chrome extension that turns the browser new tab page into a calmer workspace for open tabs, optional read-only access to Chrome bookmarks, quick links, saved reads, and lightweight todos.

This Privacy Policy explains what data Tab Harbor accesses, how that data is used, and how it is stored.

## 1. Summary

Tab Harbor is designed to work locally in the browser.

It does not require a user account.
It does not sell user data.
It does not use remote code.
It does not send workspace data to a backend controlled by the developer.

Most extension data is stored locally through Chrome extension storage APIs.

Bookmark access is optional. It is not granted at installation and is requested only after the user clicks the extension's **Show bookmarks** button.

## 2. Information the extension accesses

To provide its core features, Tab Harbor may access the following categories of data:

- Open tab metadata, including tab titles, URLs, and tab state
- Chrome bookmark titles, URLs, and folder hierarchy, but only after the user grants the optional `bookmarks` permission
- Quick links created by the user
- Saved read-later items created by the user
- Todo items created by the user
- Theme, transparency, layout, and ordering preferences selected by the user
- Clipboard image or SVG content, but only when the user explicitly pastes a custom shortcut icon

Tab Harbor does not intentionally collect sensitive categories such as health data, financial account credentials, or personal communications.

## 3. How the data is used

Tab Harbor uses the accessed data only to provide the extension’s single purpose:

- Show and organize the user’s current browser session in the new tab page
- Help the user review, group, focus, close, deduplicate, save, and restore tabs
- Show a read-only bookmark shelf, search Chrome bookmarks, and open a bookmark selected by the user
- Let the user manage quick links, saved reads, and lightweight todos in one workspace
- Restore user preferences and layout state when the new tab page is opened again
- Let the user paste a custom icon into a shortcut when they explicitly choose to do so

Tab Harbor does not use this data for advertising, profiling, creditworthiness, or unrelated analytics.

## 4. Chrome permissions and why they are needed

Tab Harbor requests the following Chrome permissions:

### `tabs`

Used to read and manage the user’s open tabs so the extension can:

- display open tabs in the workspace
- group tabs by site or workflow
- focus a selected tab
- close or deduplicate tabs at the user’s request
- save or restore tabs as part of the read-later workflow

### `storage`

Used to store user-created and user-selected local state, including:

- quick links
- saved reads
- todo items
- theme settings
- group order and layout order
- other local workspace preferences

### `search`

Used when the user types into the built-in search field and explicitly submits a search.  
This permission allows Tab Harbor to send the query through the browser’s default search engine in the current tab.

### `history`

Used only while the user is typing in the built-in search field and the inline suggestion panel is shown.  
Tab Harbor reads a bounded list of recently visited pages to suggest them as destinations, alongside open tabs, quick links, Chrome bookmarks available after optional access is granted, and saved sessions. History is read on demand while the user types, filtered in the page, and never stored, exported, or sent anywhere by Tab Harbor.

### `bookmarks` (optional)

The `bookmarks` permission is optional and is not requested during installation. Tab Harbor requests it only when the user explicitly clicks **Show bookmarks**.

When granted, it is used to:

- read Chrome's bookmark tree to show a read-only shelf; the shelf prefers the folder Chrome identifies with `folderType: "bookmarks-bar"` and otherwise falls back to the first folder under the browser bookmark root
- search bookmarks after the user types in bookmark search or the combined destination search
- listen for bookmark and permission changes so the in-memory view can refresh

Tab Harbor does not use the bookmarks API to create, rename, move, reorder, or delete bookmarks. It does not copy the bookmark tree into `chrome.storage.local`, and bookmarks are not included in configuration exports. Tab Harbor blocks bookmark URLs whose scheme is `javascript:`, `data:`, or `vbscript:`. Every other syntactically valid URL is handed to Chrome, and Tab Harbor shows feedback if Chrome cannot open it.

Bookmark website icons are off by default. If enabled, bookmark rows and bookmark search suggestions use only Chrome's extension-local `_favicon` endpoint; Tab Harbor does not fall back to a bookmark site's `favicon.ico` or a third-party favicon service.

### `clipboardRead`

Used only when the user explicitly pastes an image or SVG into the shortcut editor to create a custom shortcut icon.  
Tab Harbor does not continuously monitor or silently read clipboard contents in the background.

### `tabGroups`

Used when the user enables Chrome tab group sync features so the extension can:

- read existing native Chrome tab groups
- coordinate Chrome tab-group writes serially through the background service worker
- create groups for logical workspace groups when no safe existing group can be reused
- adopt a unique safe same-title native group without changing that group's title, color, or collapsed state
- respond when Chrome tab groups change outside the Tab Harbor page

If several existing groups are candidates, Tab Harbor does not select or merge one automatically; user confirmation is required. Adopted native groups are not auto-collapsed and are not ungrouped when sync is disabled.

### `favicon`

Used to let Tab Harbor request and display site icons for tabs, saved sessions, and quick shortcuts more reliably.  
This may include Chrome’s packaged favicon endpoint, a site’s own `favicon.ico`, or a fallback favicon service when no better icon is available.

## 5. Data storage and retention

Tab Harbor stores extension data locally using Chrome extension storage APIs, primarily `chrome.storage.local`.

This includes items such as:

- quick links
- saved reads
- todos
- theme preferences
- layout and ordering preferences

This data remains in the browser profile until the user removes it through the extension UI, clears extension storage, or uninstalls the extension.

The mapping between a logical Chrome group, a Chrome window, and the current native group ID is session-only state stored in `chrome.storage.session`. It records group/window IDs and whether a group was created or adopted; it is not included in configuration export. Legacy persistent Chrome group identity metadata is removed rather than migrated into exported configuration.

Two derived Chrome-group coordination values may be kept in `chrome.storage.local`: a declarative grouping-rule snapshot used by the background worker and a pending-cleanup flag used to resume an interrupted disable operation. Neither value is included in configuration export. Function source from an optional local grouping rule is never stored.

After optional bookmark permission is granted, bookmark data is read into memory to render and search the shelf. The bookmark tree is not copied into extension-owned local storage and is not exported.

## 6. Data sharing

Tab Harbor does not sell user data.

Tab Harbor does not transfer user data to third parties except where necessary to perform a user-requested browser action, such as:

- opening a page URL chosen by the user
- opening a Chrome bookmark chosen by the user, using the current tab by default, a background tab for Ctrl/Cmd-click or middle-click, or a new window for Shift-click
- sending a search query through the browser’s default search engine after the user explicitly submits it
- requesting favicon resources needed to display site icons in the workspace

Aside from those normal browser actions initiated by the user, Tab Harbor does not send workspace data to a developer-controlled remote service.

## 7. Remote code

Tab Harbor does not use remote code.

All JavaScript and extension assets required to run the extension are packaged with the extension bundle. Tab Harbor does not download and execute external JavaScript or WebAssembly at runtime.

## 8. Third-party services

Tab Harbor relies on Chrome’s extension platform APIs to function.

When a user opens a webpage or submits a search through the extension, the browser may connect to the destination website or the configured default search engine as part of the user’s explicit action.

To render site icons, Tab Harbor may also request favicon resources from a page’s origin or a fallback favicon service based on the page URLs already visible in the workspace.

## 9. User choices and controls

Users can control their data by:

- editing or deleting quick links
- deleting saved reads or todos
- choosing whether to grant the optional bookmarks permission, and revoking it later through Chrome's extension settings
- changing theme and layout preferences
- uninstalling the extension
- clearing extension storage through browser settings

If you do not want Tab Harbor to access your open tabs, do not use the extension.

## 10. Children’s privacy

Tab Harbor is not directed to children under 13, and the developer does not knowingly collect personal information from children.

## 11. Changes to this policy

This Privacy Policy may be updated from time to time to reflect product changes, permission changes, or legal requirements.

The latest version will be published at the public URL associated with the extension listing.

## 12. Contact

If you have questions about this Privacy Policy or Tab Harbor, you may contact:

- Publisher contact email: `lunatic.halle@gmail.com`
