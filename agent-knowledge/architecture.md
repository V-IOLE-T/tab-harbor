# Tab Harbor 架构总览

> 本文记录运行时架构契约。Dashboard 仍是纯 HTML/CSS/有序 `<script>`，无 bundler、无 ESM、无构建步骤；Chrome 标签组写入必须由 background service worker 统一协调。

## 运行上下文（三处）

| 上下文 | 入口 | 职责 |
|---|---|---|
| **Background service worker** | `extension/background.js` | 事件监听、徽章、重复空白新标签页清理、`tabs-changed` 广播，以及所有 Chrome 标签组写入的串行协调 |
| **新标签页 dashboard** | `extension/index.html` | 主工作台：卡片、拖拽、批量、Chrome 组卡片、会话、可选只读书签架、待办 |
| **Popup 面板** | `extension/popup/popup.html` (+popup.js/css) | 快捷方式 + 打开的标签页，两个视图 |

## Dashboard 脚本加载顺序（`index.html`，运行时契约，26 个 script）

> `<head>` 里第一个脚本是 `focus-redirect.js`（`focus=1` 自我重定向 workaround，见决策文档），它必须在任何其它脚本前执行。

```
focus-redirect.js —(head 首个)——
config.js → config-loader.js → icon-utils.js → session-groups.js → group-order.js
→ deferred-trigger-position.js → todos-store.js → list-order.js → background-image.js
→ i18n.js → ui-helpers.js → tab-url-utils.js → automatic-tab-groups.js
→ bookmarks-model.js → bookmarks-shelf.js
→ search-suggestions.js → tab-sessions.js
→ session-manager.js → theme-controls.js → config-sync.js → drawer-manager.js
→ chrome-tab-groups-import.js → chrome-tab-groups-sync.js → dashboard-runtime.js → app.js
```

顺序契约要点：
- 早期是**纯工具**（config/icon/session-groups/group-order/…），中段是**状态与存储**（tab-sessions/session-manager/theme-controls/config-sync），后段是 **UI 运行时**（drawer/chrome-tab-groups/dashboard-runtime/app）。
- `focus-redirect.js` 必须保持 `<head>` 首个脚本——改动它的位置 = 新标签页焦点行为回归。
- `automatic-tab-groups.js` 依赖 URL 与图标 helper，必须位于 `tab-url-utils.js` 之后；它只计算自动分组定义、live 原生组分析和 desired snapshot，由 Dashboard 与 worker 共用。
- `config-loader.js` 只在扩展页面中尝试加载被 gitignore 的可选 `config.local.js`；加载失败会安静回退到 `config.js`。Service worker 不加载这份私有覆盖。
- `bookmarks-model.js` 必须先于 `bookmarks-shelf.js`；两个文件都是 IIFE，不会自行挂载，工作区入口显式调用 `mountBookmarksShelf` / `createBookmarksShelf`。
- `dashboard-runtime.js` 是最大的运行时中枢；`app.js` 保持薄编排。
- 改动脚本顺序 = 高风险变更；新增文件必须插入正确依赖位，并跑测试 + 真机验证。

## 模块职责地图

| 文件 | 职责 | 备注 |
|---|---|---|
| `app.js` | 编排入口，调 `mountDashboardRuntime` 等 | 保持薄 |
| `focus-redirect.js` | 新标签页焦点 workaround：首次加载 `location.replace('?focus=1')` 把"新建标签页"变"导航页"，使搜索框可抢焦点 | `<head>` 首个脚本，无依赖 |
| `dashboard-runtime.js` | 打开标签卡片渲染、拖拽/多选/批量、Chrome 组卡片、会话恢复执行、书签架挂载、事件委托、搜索建议接线、焦点重试 | **最大文件**，改动前先看子文档 |
| `tab-url-utils.js` | 标签 URL 归一化（suspended 解包、canonical、可恢复判断） | 纯逻辑 |
| `automatic-tab-groups.js` | 自动分组纯策略：逻辑组定义、显示名/颜色、原生组安全候选分析与 sync snapshot | Dashboard 与 worker 共用；不调用 Chrome 写 API |
| `bookmarks-model.js` | Chrome 书签树索引、根选择、面包屑、规范化与脚本型 URL 协议阻止 | 纯逻辑；`folderType=bookmarks-bar` 优先，首个顶层文件夹回退 |
| `bookmarks-shelf.js` | 可选权限门、单列纵向的只读文件夹/搜索 UI、打开语义、书签与权限事件刷新 | 不复制、不写入、不导出书签树 |
| `search-suggestions.js` | 搜索建议纯逻辑：构建/跨来源 URL 去重/打分/过滤（打开标签、快捷链接、书签、会话、历史） | 优先级 tab > shortcut > bookmark > session > history |
| `theme-controls.js` | 主题/背景/快捷链接/搜索引擎/书签 favicon/每行列数等设置项与 DOM 开关 | 书签 favicon 默认关闭，入口位于桌面设置 → 功能 |
| `ui-helpers.js` | 图标库（ICONS）、通用 DOM/转义 helper | 含 escapeHtml 等 |
| `chrome-tab-groups-sync.js` | Dashboard 侧适配：查询/展示用户组，借共享策略构建显式流程所需 snapshot，并发送 sync/merge/state 请求 | 普通 Chrome 事件只触发只读刷新，不由此模块重复提交自动同步 |
| `chrome-tab-groups-coordinator.js` | Background 内的 Chrome 标签组串行协调器；校验、预读 live state、adopt/create/merge、session mapping | 由 `background.js` 用 `importScripts` 加载；见 chrome-tab-groups.md |
| `tab-sessions.js` | 会话保存/恢复的状态归一化与 plans 生成 | 纯逻辑，可测 |
| `session-manager.js` | 会话管理器 UI（保存/恢复/删除会话） | |
| `session-groups.js` | 手动分组的归一化/增删/重命名状态函数 | 纯逻辑 |
| `group-order.js` | 分组排序状态（sessionOrder/pinnedOrder） | 纯逻辑 |
| `config-sync.js` | 配置导出/导入（STORAGE_KEYS 全量） | 导出未设置键为 null；不含书签树或 session-only Chrome 组映射 |
| `config-loader.js` / `config.js` | Checked-in 默认配置与页面端可选私有覆盖 | `config.local.js` 被 gitignore，仅由页面 loader 尝试加载 |
| `background.js` | 后台事件 + 空白新标签去重 + 通知 + 无页面依赖的自动标签组调度 + coordinator 消息入口 | Worker 注册只导入随包脚本；自动同步按窗口 debounce |
| `popup/popup.js` | popup 双视图、动画、刷新 | 见 popup-panel.md |

## Service worker 注册依赖与发行闭包

Manifest V3 worker 的同步导入是发行包契约：`background.js` 请求的每个 `importScripts` 资源都必须确定存在于安装包中，否则不能把缺失请求视作可恢复的运行时异常。

当前 worker 按顺序只导入五个 checked-in 文件：

1. `config.js`
2. `icon-utils.js`
3. `tab-url-utils.js`
4. `automatic-tab-groups.js`
5. `chrome-tab-groups-coordinator.js`

`config.local.js` 是扩展页面的可选私有分组覆盖，不属于发行包，也不得在 worker 注册阶段请求。Dashboard 等待它加载后，把可声明式表达的规则发布为内部 `automaticTabGroupRuleOverrides` 快照；worker 只读取该快照，不执行存储中的代码。若规则含函数谓词，快照会标记为 dashboard-only，后台自动 desired 写入 fail-closed，显式 Dashboard 同步仍使用完整规则。

## 存储键（chrome.storage.local）

- `themePreferences`（主题/功能开关/搜索引擎/列数；`bookmarksShowFavicons` 严格布尔且默认为 false，作为本地桌面偏好随整个 `themePreferences` 导入/导出）
- `quickShortcuts`（快捷链接）
- `savedTabSessions`（保存的会话）
- `savedTabSessionOrder` / `savedTabSessionCollapsedState`
- `sessionGroups`（手动分组状态，含 assignments）
- `groupOrder` / `groupTabOrder` / `groupLabelOverrides`
- `todos`
- `languagePreference`
- `chromeTabGroupsEnabled`（同步开关）
- `automaticTabGroupRuleOverrides`（Dashboard 发布给 worker 的内部规则快照；函数源码不写入，且不进入配置导出）
- `chromeTabGroupsCleanupPending`（background 关闭同步的内部恢复标记；派生状态，不进入配置导出）
- `importedChromeSessionGroups`
- `popupView`（popup 视图偏好，也经 chrome.storage）

导出/导入用 `config-sync.js` 的 `STORAGE_KEYS` 全量列表。Chrome 书签树不会复制到 `storage.local`，也没有配置导出键。

## 会话期状态（chrome.storage.session）

- `chromeTabGroupsSessionMap`：`{ groupKey: { windowIdStr: { groupId, origin } } }`。
- `origin` 只有 `created` / `adopted`；映射只解决当前浏览器会话中逻辑组、窗口与会变化的原生 groupId 归属，不是用户配置。
- 此键不进入配置导出/导入。旧的 local `chromeTabGroupsMeta` 会被清理，而不是迁入导出数据。

## 一言的页面实例生命周期

一言以当前新标签页 document 为生命周期边界：每个实例最多选择并渲染一条缓存文案。

- `hitokotoPageState` 保存 `entry` / `locked` / `rendered` / `warmPromise`；`lockHitokotoForCurrentPage()` 在实例首次初始化时锁定当时的 `cache[0]`（包括 `null`）。
- `syncHitokotoForCurrentPage()` 在检查功能开关前先锁定条目；禁用时只隐藏不清空，同一实例重新启用仍复用原条目。无有效缓存时当前页保持安静隐藏。
- Dashboard 后续重渲染只复用本实例已锁定的结果，不再读取更新后的缓存选取替代文案。窗口 focus 和页面 visibility 变化也没有一言副作用。
- `warmHitokotoCacheInBackground()` 用同一个 `warmPromise` 保证每个实例最多预热一次；返回值只写入 `hitokotoCache`，不持有或修改当前 DOM。新缓存从下一个新标签页实例开始生效。
- `fetchHitokoto()` 的 3 秒 AbortController 超时覆盖从 `fetch` 发起到 `response.json()` 完成的整个流程，不在收到响应头时提前撤销；成功、失败和中止都由 `finally` 清理 timer。
- 预热失败保持静默，不阻塞 Dashboard 渲染。

## 消息流

- worker 在启动、安装/升级、同步开关由非 true 变为 true，以及普通 tabs created/updated/removed/replaced/moved/attached/detached 事件后安排自动同步；`onUpdated` 只在 URL、groupId 或 pinned 变化时安排，窗口整体关闭的 `onRemoved` 不安排。
- 自动同步不依赖 Dashboard 常驻。每个窗口使用独立的 **275ms debounce** 槽；burst 只读取一次最新完整快照，运行中到达的事件标记 dirty，并在该轮结束后至多安排一轮 trailing debounce。不同窗口最终仍进入 coordinator 的全局串行队列。
- 每轮先查询设置与已发布规则快照。快照尚未初始化、损坏或标记为 dashboard-only 时不会读取 live 组或提交默认规则写入；声明式快照有效后，才读取窗口 tabs，通过 coordinator `get-state` 取得 fail-closed 原生组状态并提交 `sync`。任一查询失败或 snapshot 无效都不把空状态解释为清理权限。
- 同步关闭时 background 先写入 `chromeTabGroupsCleanupPending=true` 再提交全窗口清理；成功后清除，失败按 1–30 秒退避。startup/install 与 disabled 状态下后续标签事件会读取标记续做，成功后不再重复查询 coordinator。
- background `notifyTabHarborPages({source, triggerTabId, windowId})` 仍广播 `tabs-changed`；Dashboard 忽略带有其他 windowId 的消息。直接 Chrome group/tabs 订阅也过滤已知的其他窗口，无法判定窗口时保守刷新。
- Dashboard 在首次异步加载前就注册 background 消息监听；启动或本地操作的 suppression 窗口只延后事件，不丢弃。两条通知路径共用 `window.__tabRefreshTimeout`，最终只执行 `renderDashboard({syncChromeGroups:false})` 的只读刷新。异步重绘期间的新事件只标记 dirty，并在当前轮结束后至多追加一轮，不并发重写标签卡片 DOM。刷新失败若命中 "Extension context invalidated" 会触发页面自动 reload 重绑。
- Dashboard 的 Chrome 组写请求使用 `sync-chrome-tab-groups` / `merge-chrome-tab-groups`，状态读取使用 `get-chrome-tab-group-state`；`background.js` 验证扩展来源后转成 coordinator 的 `sync` / `merge` / `get-state`。
- Coordinator 用一条全局 promise queue 串行执行所有窗口的写入、merge 和 state 查询；同一窗口尚未执行的 sync 只保留最新 snapshot。所有 live query 在本轮首个写入前完成，全局查询失败时为零写入；`created` 组的实时 title/color 已相同时跳过 `tabGroups.update`，减少扩展自身写入的事件回声。
- 书签权限只由书签架的明确按钮调用 `chrome.permissions.request({permissions:['bookmarks']})`；搜索本身绝不触发授权。授权后监听 bookmark/permission 事件并 debounce 重载，generation token 防止旧异步结果覆盖新状态。

## 关键常量

- 组 key 前缀：`MANUAL_GROUP_PREFIX = '__session_group__:'`、`CHROME_GROUP_PREFIX = '__chrome_group__:'`（`dashboard-runtime.js` 与 `tab-sessions.js` 各有定义，语义一致）。
- Chrome 组颜色映射 `CHROME_GROUP_COLOR_MAP`（grey/blue/red/yellow/green/pink/purple/cyan/orange → hex）。
- Chrome 组 session mapping：`SESSION_MAP_KEY = 'chromeTabGroupsSessionMap'`；origin 为 `created` / `adopted`。
- 书签权限：`BOOKMARKS_PERMISSION = 'bookmarks'`，位于 manifest `optional_permissions` 而非安装期 `permissions`。
- 空白新标签 grace 期 `NEW_TAB_GRACE_PERIOD_MS = 5000`（background.js）。

## 测试

- 全量命令：`node --test extension/*.test.js`。不要在文档中固化容易过期的 pass 数量。
- 重点文件：`batch-drag.test.js`（拖拽与只读事件刷新）、`automatic-tab-groups.test.js`（Dashboard/worker 共用自动策略）、`background-worker-load.test.js`（随包 import 闭包、顶层绑定与缺失依赖负向启动 smoke）、`background-tab-groups.test.js`（无 Dashboard 的后台触发、按窗口 debounce、trailing 与 fail-closed）、`chrome-tab-groups-sync.test.js` / `chrome-tab-groups-coordinator.test.js`（页面适配、串行协调与 no-op 回声收敛）、`bookmarks-model.test.js` / `bookmarks-shelf.test.js`（书签模型与控制器）、`hitokoto-lifecycle.test.js`（单实例锁定与预热隔离）、`ui-regression.test.js`（回归断言含源码正则）、`search-suggestions.test.js`（建议纯逻辑）、`focus-redirect.test.js`（焦点重定向）、`background.test.js`（重复新标签关闭 + grace 补查）、`tab-sessions.test.js`。
- `ui-regression.test.js` 用正则断言源码中关键函数签名存在（如 `restoreChromeGroupsForSession`），改函数签名需同步更新。
- Node 测试只能验证纯逻辑与 mock API 契约；optional permission 弹窗、`storage.session` 生命周期、真实标签组写入和快捷键打开语义仍需在目标 Chrome 版本真机验证。
