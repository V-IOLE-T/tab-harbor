# Tab Harbor 架构总览

> 合并后代码为准（PR #42 之后）。纯 HTML/CSS/有序 `<script>`，无 bundler、无 ESM、无构建步骤。

## 运行上下文（三处）

| 上下文 | 入口 | 职责 |
|---|---|---|
| **Background service worker** | `extension/background.js` | 事件监听（tabs/tabGroups）、坏徽章、重复空白新标签页清理、`tabs-changed` 广播 |
| **新标签页 dashboard** | `extension/index.html` | 主工作台：卡片、拖拽、批量、Chrome 组卡片、会话、待办 |
| **Popup 面板** | `extension/popup/popup.html` (+popup.js/css) | 快捷方式 + 打开的标签页，两个视图 |

## Dashboard 脚本加载顺序（`index.html`，运行时契约，23 个 script）

> `<head>` 里第一个脚本是 `focus-redirect.js`（`focus=1` 自我重定向 workaround，见决策文档），它必须在任何其它脚本前执行。

```
focus-redirect.js —(head 首个)——
config.js → config-loader.js → icon-utils.js → session-groups.js → group-order.js
→ deferred-trigger-position.js → todos-store.js → list-order.js → background-image.js
→ i18n.js → ui-helpers.js → tab-url-utils.js → search-suggestions.js → tab-sessions.js
→ session-manager.js → theme-controls.js → config-sync.js → drawer-manager.js
→ chrome-tab-groups-import.js → chrome-tab-groups-sync.js → dashboard-runtime.js → app.js
```

顺序契约要点：
- 早期是**纯工具**（config/icon/session-groups/group-order/…），中段是**状态与存储**（tab-sessions/session-manager/theme-controls/config-sync），后段是 **UI 运行时**（drawer/chrome-tab-groups/dashboard-runtime/app）。
- `focus-redirect.js` 必须保持 `<head>` 首个脚本——改动它的位置 = 新标签页焦点行为回归。
- `dashboard-runtime.js` 是最大的运行时中枢（约 7300 行）；`app.js` 只有 31 行，薄编排。
- 改动脚本顺序 = 高风险变更；新增文件必须插入正确依赖位，并跑测试 + 真机验证。

## 模块职责地图

主页卡片通过 `dashboard-runtime.js` 的 `focusTab` 切换到已打开的标签页；目标激活、窗口聚焦和标签组展开成功后，`closeDashboardAfterTabFocus` 只关闭缓存 ID 对应且仍为 Tab Harbor 新标签页的来源页。切换失败、来源页已导航或目标就是来源页时不关闭；清理失败不重试跳转。搜索建议沿用原有行为。

| 文件 | 职责 | 备注 |
|---|---|---|
| `app.js` | 编排入口，调 `mountDashboardRuntime` 等 | 保持薄 |
| `focus-redirect.js` | 新标签页焦点 workaround：首次加载 `location.replace('?focus=1')` 把"新建标签页"变"导航页"，使搜索框可抢焦点 | `<head>` 首个脚本，无依赖 |
| `dashboard-runtime.js` | 打开标签卡片渲染、拖拽/多选/批量、Chrome 组卡片、会话恢复执行、事件委托、搜索建议接线、焦点重试 | **最大文件**，改动前先看子文档 |
| `tab-url-utils.js` | 标签 URL 归一化（suspended 解包、canonical、可恢复判断） | 纯逻辑 |
| `search-suggestions.js` | 搜索建议纯逻辑：构建/去重/打分/过滤（打开标签、快捷链接、会话、历史） | 纯逻辑，可测 |
| `theme-controls.js` | 主题/背景/快捷链接/搜索引擎/每行列数等设置项与 DOM 开关 | 设置项入口 |
| `ui-helpers.js` | 图标库（ICONS）、通用 DOM/转义 helper | 含 escapeHtml 等 |
| `chrome-tab-groups-sync.js` | Chrome 标签组同步：镜像组管理、用户组查询、指纹匹配、折叠 | 见 chrome-tab-groups.md |
| `tab-sessions.js` | 会话保存/恢复的状态归一化与 plans 生成 | 纯逻辑，可测 |
| `session-manager.js` | 会话管理器 UI（保存/恢复/删除会话） | |
| `session-groups.js` | 手动分组的归一化/增删/重命名状态函数 | 纯逻辑 |
| `group-order.js` | 分组排序状态（sessionOrder/pinnedOrder） | 纯逻辑 |
| `config-sync.js` | 配置导出/导入（STORAGE_KEYS 全量） | 导出未设置键为 null |
| `config-loader.js` / `config.js` | 配置读取与本地覆盖 | `config.local.js` 被 gitignore |
| `background.js` | 后台事件 + 空白新标签去重 + 通知 | 见 audit-hardening.md |
| `popup/popup.js` | popup 双视图、动画、刷新 | 见 popup-panel.md |

## 存储键（chrome.storage.local）

- `themePreferences`（主题/功能开关/搜索引擎/列数）
- `quickShortcuts`（快捷链接）
- `savedTabSessions`（保存的会话）
- `savedTabSessionOrder` / `savedTabSessionCollapsedState`
- `sessionGroups`（手动分组状态，含 assignments）
- `groupOrder` / `groupTabOrder` / `groupLabelOverrides`
- `todos`
- `languagePreference`
- `chromeTabGroupsEnabled`（同步开关）
- `chromeTabGroupsMeta`（镜像组持久化：windowId → {title,color}）
- `popupView`（popup 视图偏好，也经 chrome.storage）

导出/导入用 `config-sync.js` 的 `STORAGE_KEYS` 全量列表。

## 消息流

- background `notifyTabHarborPages({source, triggerTabId})` → `chrome.runtime.sendMessage({action:'tabs-changed', ...})` → dashboard 收消息后 **300ms debounce** → `renderDashboard`。
- dashboard 侧 `setupTabChangeListener()` 统一挂监听；刷新失败若命中 "Extension context invalidated" 会触发页面自动 reload 重绑。
- Chrome 组事件（tabGroups onCreated/onUpdated/onRemoved、tabs onAttached）由 `chrome-tab-groups-sync.js` 的订阅通道单独通知 dashboard 侧，与 tabs-changed 广播分离。

## 关键常量

- 组 key 前缀：`MANUAL_GROUP_PREFIX = '__session_group__:'`、`CHROME_GROUP_PREFIX = '__chrome_group__:'`（`dashboard-runtime.js` 与 `tab-sessions.js` 各有定义，语义一致）。
- Chrome 组颜色映射 `CHROME_GROUP_COLOR_MAP`（grey/blue/red/yellow/green/pink/purple/cyan/orange → hex）。
- 空白新标签 grace 期 `NEW_TAB_GRACE_PERIOD_MS = 5000`（background.js）。

## 测试

- 全量：`node --test extension/*.test.js`（PR #42 合并后 422 pass / 0 fail；搜索建议 + 焦点重定向 + 重复标签修复后 449 pass / 0 fail）。
- 重点文件：`batch-drag.test.js`（拖拽）、`chrome-tab-groups-sync.test.js`（组同步）、`ui-regression.test.js`（回归断言含源码正则）、`search-suggestions.test.js`（建议纯逻辑）、`focus-redirect.test.js`（焦点重定向）、`background.test.js`（重复新标签关闭 + grace 补查）、`tab-sessions.test.js`。
- `ui-regression.test.js` 用正则断言源码中关键函数签名存在（如 `restoreChromeGroupsForSession`），改函数签名需同步更新。
