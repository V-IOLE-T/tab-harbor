# 拖拽/多选/批量子系统（dashboard-runtime.js）

> 桌面页的标签行手柄多选 + 批量拖动 + 批量操作栏集中在 `dashboard-runtime.js`；涉及原生 Chrome 组的写入会转交 background coordinator。

## 选择模型

- `selectedPageChipIds`：Set，存 chip 的 **sort id**（`getPrimaryTabOrderToken` 生成，不一定是纯 tab id，可能是 URL 类 token）。
- 操作：
  - 手柄单击 = 切换选中；Shift+单击 = 范围选择（`selectPageChipRange`，锚点 `pageChipSelectionAnchorId`）；
  - 行主体点击：有选择时切换选中，无选择时激活标签（`focusTab`）；
  - Escape / 点卡片外 = 清除选择。
- **指针手势三分**：press 不移动 = 点击（toggle）；移动 = 拖拽；拖拽完成后的合成 click 用 `suppressPageChipClickUntil`（250ms）抑制，避免二次触发。
- `pageChipPointerToggleGuard`：touch/pen 合成 click 去重（400ms 窗口）。
- 键盘：手柄是真实 `<button>`，聚焦后 Enter/Space 原生触发 click（`e.detail === 0` 识别键盘激活）；**不要**在 keydown 里 preventDefault 空格——那会连按钮激活一起取消（历史 bug，PR 已修）。

## 批量拖动语义

- `finishPageChipDrag()`：核心提交函数。`pageChipCommitInFlight` 标志防止提交中途 Escape 清空状态（提交在 await 之后要读 drag 状态）。
- 同组重排：拖拽开始时快照顺序（`previewPageChipOrder` + FLIP 动画 + placeholder），保持选中行相对顺序落盘。
- 跨卡片移动：`moveDraggedPageChipToGroup(targetGroupKey, targetListEl)` 按每行所属卡片分别收集（`collectMovingTabIds`）。
- 拖到用户 Chrome 组卡片 = 加入原生组（见 chrome-tab-groups.md）；从 Chrome 组拖出 = 先 ungroup。
- 新建组：`createSessionGroupFromDraggedPageChip`；拖到死区 = 取消并还原（不清除选择）。
- 边缘自动滚动：`updatePageChipAutoScroll`（rAF，上下 64px 边缘区，速度随深度增强），滚动后重新解析 drop target。

## 溢出展开持久化

- 卡片 >8 行显示"+N more"；展开状态记在 `expandedPageChipGroupKeys`（Set），跨渲染保持；卡片消失时清理。
- 展开行与可见行走同一渲染器 `buildPageChipHtml`（可拖拽可排序可选中），隐藏用 `page-chip--collapsed` class（保留在 DOM，drag 候选排除）。

## 批量操作栏（syncPageChipBatchBar）

- 选中后区块头部原地变批量栏，按钮：清除选择 / 去重 / 合并 Chrome 组 / 休眠 / 保存会话 / 关闭。
- `batchActionInFlight` 重入锁防连点双执行。

## 统一动作 helper（live-state 重新校验）

close/sleep/dedup 仍使用 Dashboard 共享 helper；原生标签组的 create/join/ungroup 路径保留原 helper 名以减少调用面变动，但它们已改为发送 `merge-chrome-tab-groups` 内部请求。Coordinator 会在串行队列中重读 live state，过滤失效/pinned 标签并拒绝 shared 组冲突。

- `groupTabsWithStaleRetry(tabIds)` → background `operation:'create'`。
- `groupTabsWithStaleRetryIntoGroup(groupId, tabIds)` → background `operation:'join'`。
- `ungroupTabsWithStaleRetry(tabIds)` → background `operation:'ungroup'`。
- `closeTabsSafely(tabIds, {playSound})`：`Promise.allSettled` 并行 + `ensureWindowsKeepLastTab` 保每窗口最后一标签。
- `closeTabsByUrlsSafely(urls, {exact})`：hostname 匹配（file:// 精确匹配）+ 窗口保护。
- `closeDuplicatesByUrls` / `closeDuplicatesInSelection`：按 URL 分组保留 active。
- `sleepTabsByIds(tabIds, {skipActive})`：先 `tabs.get` 校验存活（stale 计数）+ discard。
- `mergeTabsIntoChromeGroup(tabIds, {title, color})`：先按 live tab 计算标题，再由 background 创建并设置外观；外观更新失败会保留已创建组并向调用方返回 `updated:false`。

## 命名与标题

- `buildBatchMergeGroupTitle(tabIds)`：按选中内容自动命名——最常见域名优先（GitHub/YouTube 品牌大小写白名单），混合组加 `×N`；fallback 到首个标题或 "Selected (N)"。
- `buildPageChipHtml(tab, group, urlCounts, collapsed)`：所有行统一渲染（占位行、discarded、选中、溢出共用）。
- 卡片头动作：去重 / 合并 Chrome 组 / 休眠 / 保存会话 / 关闭（`buildOpenTabsSectionActions` 区块级 + 卡片级）。

## 打开标签行的几何稳定

标签行及其内部控件的 hover/focus 反馈不得改变元素几何或指针命中区，避免位移导致 hover 反复进出。

- `.mission-card` 的常态 transition 和 hover 不含 `transform`；关闭动画的独立 scale 规则不属于交互反馈。
- `.page-chip.clickable:hover` 只改背景；动作按钮的 hover/focus 只改颜色、背景、透明度、outline 或 shadow，不改尺寸、内外边距、边框宽度或 transform。
- `.chip-actions` 始终作为 `flex` 槽位且不收缩，行内按钮固定为 28×28；显隐反馈不能通过移除槽位触发重排。
- tooltip 绝对定位且 `pointer-events:none`，不参与布局也不抢占命中区。

## 已知注意点

- `getSelectedBatchTabIds()` / `getPageChipTabIdMap()` 用当前 DOM 的 sort id → tab id 映射，跨卡片保留原始 chip id。
- `__suppressAutoRefreshUntil` 手动清零易漏，优先用 `runWithSuppressedRefresh` / `beginBatchAction`+`finishBatchAction`（final 保证清）。
- 测试集中在 `batch-drag.test.js`（+1018 行），改拖拽逻辑必跑。
