# 浏览器工作区功能

本章记录本次标签组去重、只读书签入口与统一搜索的行为契约，并保留 Tab Harbor 安静、文学性和易扫读的视觉方向。

## 一言页面实例稳定性

每个新标签页实例最多从启动时缓存选择一条一言，页面存续期间不会因异步完成或界面刷新替换当前文案。

[[extension/dashboard-runtime.js#syncHitokotoForCurrentPage]] 先锁定启动时的 `cache[0]`（包括空值），再同步开关可见性；同一实例关闭后重新开启仍显示原文案。

无有效缓存时当前页保持隐藏。[[extension/dashboard-runtime.js#warmHitokotoCacheInBackground]] 每个实例最多执行一次，只更新 `hitokotoCache` 供下一个新标签页使用；Dashboard 重渲染、窗口 focus 和页面 visibility 变化均不重新选取。

## Chrome 标签组协调

Dashboard 与 service worker 共用纯自动分组策略；后台可在没有 Dashboard 的情况下持续对账，原生组的接管、创建、更新、解组、重排与合并统一由 coordinator 执行。

逻辑组输入为 `{groupKey,title,color,collapsed,tabIds}`。详细写入边界见 [[architecture#后台标签组写入所有权]]。

### 后台持续自动同步

普通标签事件由 service worker 按窗口合并处理，Dashboard 只读刷新可见状态，不承担后台持续同步的存活条件。

启动、安装/升级、启用同步与 tabs created/updated/removed/replaced/moved/attached/detached 会触发相关窗口调度。每个窗口先等待 275ms；运行中事件合并为结束后的至多一轮 trailing 对账，跨窗口写入仍保持全局串行。

每轮以最新完整 tabs/native-group 状态调用 `automatic-tab-groups.js`。任一读取失败或策略输出无效时不提交 sync；对 `created` 组的 title/color 已一致时也不调用 no-op `tabGroups.update`，避免自写事件持续回响。

### 自定义规则一致性

页面与 worker 必须使用同一份可表达规则；worker 不加载可缺失的私有脚本，也不得用默认规则覆盖 Dashboard 按自定义规则创建的原生组。

Dashboard 在首次原生组同步前，将 `LOCAL_LANDING_PAGE_PATTERNS` 与 `LOCAL_CUSTOM_GROUPS` 的 hostname/path/group 字段规范化为 `automaticTabGroupRuleOverrides`。声明式快照由后台持续使用；它是内部派生状态，不进入配置导出。

函数型 landing `test` 无法安全序列化，因此只存 `backgroundSafe=false`，从不存函数源码。该状态下 background 的普通标签事件只跳过自动 desired 写入，coordinator 的 Dashboard 显式请求与关闭同步清理仍可执行，避免两套规则争用。

### 规范化主域名键

普通 HTTP(S) 标签以规范化主域名作为自动 `groupKey`：`www` 与常规子域归并，不同主域严格隔离。

键计算先将 hostname 小写并移除开头的 `www.`，常规子域归并到主域；内置列表识别的多段公共后缀保留可注册域层级，已知多租户托管后缀保留租户 hostname。实现未内置完整 Public Suffix List，未知后缀按末两段回退。

Landing page、自定义分组和 `file:` 规则先于普通主域名规则。显示标题、友好名称和用户标签覆盖只改变呈现，不改变 `groupKey`；即使两个组显示同名，不同主域也不得自动合并或互相接管。

### Created 组跨域导航迁移

标签从主域 A 导航到主域 B 时，只有来源映射为 `origin=created` 才允许自动迁移；迁移不关闭标签。

后台以最新 URL 和 live membership 对账，将原 tabId 从 A 的扩展创建组转入 B 的逻辑组。A 仍有同域成员时保留原组；A 不再有成员时移除旧 mapping，并由 Chrome 清理空组。B 继续遵守安全候选规则，只能复用已验证目标或创建一个新组。

来源为 `adopted`、Tab Harbor 手动分组或不受扩展所有的原生组时，不把跨域导航视为自动移动授权，而是保留现状并 fail-closed。迁移所需的标签、来源组、目标组或成员查询不完整时，本次迁移零写入并保留已有映射。

### Dashboard 只读事件刷新

Background 消息监听在首次异步加载前注册；启动或本地操作的 suppression 窗口只延后通知，不丢弃。广播和直接 Chrome 事件共享一个 Dashboard 刷新 timer，已知其他窗口的事件不会重绘当前工作台；重绘中的事件只合并成至多一轮尾随刷新，不启动并发渲染。

事件路径调用 `renderDashboard({syncChromeGroups:false})`，只更新当前窗口卡片、汇总与搜索建议；无法识别窗口的事件保守刷新，但不会再发起一份自动同步。

### 唯一候选接管

原生组只有在同窗口、标题完全相同、非 shared、成员查询完整且所有成员都属于该 desired 逻辑组时，才能成为安全候选。

恰好一个候选时记为 `adopted` 并加入同域缺失标签；无候选时创建 `created` 组。颜色不是接管条件，因为 adopted 组必须保留用户的外观。

### 冲突与确认合并

多个安全候选会返回 `multiple-candidates` 冲突，同步轮次不新建第 N+1 个组；Dashboard 展示候选成员并等待用户选择目标组。

即使其中一个候选已有 session mapping，旁边新增的安全同名组也必须进入同一冲突，不能只报为不可操作的额外成员。候选按标签栏最左成员的位置排序，保证“从左第 N 组”对应实时顺序。

对话框打开时记录候选的 groupId、标题、颜色以及按顺序排列的成员 tabId 和 URL。确认后 background 必须重新读取并与该快照完全一致，才会把源组标签加入目标组；状态已变化时拒绝执行，避免确认内容与实际写入对象脱节。

成功合并依合并前的 live index 重排，不关闭标签，也不修改目标组标题、颜色或折叠状态。不同逻辑 groupKey 的现有映射不能被一次合并强行覆盖。

### Fail-closed 和冻结

每轮同步先读取窗口标签组、窗口标签及每个组的成员；全局查询失败时整轮零写入，单组查询不完整时只冻结受影响的逻辑组。

后台自动轮次在窗口 tabs 查询、coordinator `get-state` 或 snapshot 校验任一步失败时也会停止，不把空值传给 sync。

冻结时保留现有映射和原生组，不创建替代组。Dashboard 状态查询失败、adopted 组标题被用户修改、标签失效、跨窗口、被 pinned、身处不允许的其他原生组或候选混入无关标签时也不猜测式修复。

已验证的 `created` 跨域导航是“身处其他原生组”规则的唯一自动迁移例外，且仍受 [[features#Chrome 标签组协调#Created 组跨域导航迁移]] 的所有权与查询完整性约束。

### Created 与 adopted

`created` 组只在首次创建时应用 desired 初始折叠值；后续同步维护标题、颜色和成员，但保留 Chrome 中用户手动展开/折叠的实时状态。

若 live title/color 已与 desired 一致，后续同步不调用 `tabGroups.update`；这不会影响显式用户 update 操作。

逻辑组消失或关闭同步时，`created` 组在成员查询完整后可解组并移除映射。

`adopted` 组只接收同逻辑域标签，不自动改名、改色或折叠。关闭同步时不解组，并保留当前 session 映射以便重新启用时复核 live state。

关闭同步是全窗口操作：background 先识别仍存活的映射窗口并完成所需读取，再清理所有 `created` 组；已经关闭窗口的过期映射直接修剪，不能因无效 windowId 阻断其他窗口。

若关闭时 Chrome 查询失败，设置仍保持关闭以阻止新同步写入，但 UI 不会宣称清理已完成；background 与仍打开的 Dashboard 会继续重试，下一次启动也会根据残留 `created` 映射续做。`adopted` 映射不触发解组。

## 只读书签镜像

书签架是 Chrome 书签树的只读视图，位于快捷链接下方，不建立第二份书签数据库，也不改变 Chrome 书签。

`extension/bookmarks-model.js` 建立树索引，`extension/bookmarks-shelf.js` 管理权限、导航、刷新与打开语义。

### 可选权限与根选择

首次显示未授权的安静状态，只有明确点击“显示书签”才请求 `bookmarks` 权限；拒绝、撤销、空树和 API 失败分别显示可恢复状态。

书签栏根优先选择 `folderType === "bookmarks-bar"` 的顶层文件夹；旧字段不可用时回退到浏览器书签根下的第一个文件夹，不依赖 ID 或本地化标题。

### 文件夹导航与刷新

顶层书签、文件夹和搜索结果统一使用单列纵向列表和纵向滚动，不依赖横向滚动；进入文件夹后使用面包屑原位返回，架内搜索不改变 Chrome 书签树。

创建、修改、移动、删除、子项重排和导入结束事件经 debounce 后重读树；generation token 使过期查询或渲染结果无法覆盖较新状态。

树读取期间新输入的搜索词会立即记录为最新意图；新树返回后以该词重新搜索，不能用刷新开始时的旧查询清空输入或结果。

### 打开语义与 URL 安全

普通点击在当前 Tab Harbor 页打开，Ctrl/Cmd 点击或中键在后台新标签打开，Shift 点击创建新窗口。

`javascript:`、`data:` 和 `vbscript:` 书签 URL 在导航前被阻止；其他语法有效的 URL 交给 Chrome 导航，Chrome 拒绝时显示安静失败反馈。

## 书签网站 favicon 本地偏好

书签叶子行与统一搜索中的书签结果默认不显示网站 favicon，用户可在“桌面设置 → 功能”中明确开启；`bookmarksShowFavicons` 是严格布尔的本地偏好，随 `themePreferences` 导入/导出。

关闭时书签架叶子行使用安静符号，搜索中的书签结果不解析图标，文件夹始终使用 `▱`；开启后两处都只接受 Chrome `chrome-extension://…/_favicon/` 资源，失败不走站点或第三方网络 fallback。切换只原地重绘，不重新授权或读树。

## 统一搜索建议

顶部搜索将已打开标签、快捷链接、已授权书签、保存会话和历史组装为同一组建议，书签文件夹路径也参与匹配。

[[extension/search-suggestions.js#assembleSuggestions]] 保持纯函数边界，Dashboard 负责 Chrome API 读取、渲染和激活。

### 来源优先级与去重

固定来源优先级为打开标签 > 快捷链接 > 书签 > 已保存会话 > 历史；相同 URL 跨来源只保留高优先级结果。

会话建议同时展开直接 `tabs`、单窗口和多窗口快照，避免嵌套数据形状丢失标签。未授权时书签源为空，搜索输入本身不请求权限。

### 组合框与激活语义

搜索框使用 combobox、`aria-activedescendant` 与稳定 option ID，支持方向键、Enter 和 Escape；滑动、中键和触屏激活不依赖 hover。

打开标签建议普通激活时聚焦原标签；书签建议沿用书签架的当前页/后台标签/新窗口语义；其他 URL 建议普通激活时打开前台新标签。

## Tab row multi-select and batch drag

标签行手柄支持单选、Shift 范围选择和键盘激活；拖动已选行时保持它们的相对顺序，并在同组重排、跨组移动或新建组时一次提交。

拖入、拖出原生 Chrome 组或批量合并的标签组写入也必须经过 [[architecture#后台标签组写入所有权]]，不得由 Dashboard 直接发起 `tabs.group` 或 `tabs.ungroup`。

## 打开标签行几何稳定性

打开标签行的 hover 和内部控件 focus 只改变非几何视觉反馈，不移动行、改变命中区或触发按钮重排。

卡片与行不使用 hover transform；动作区始终预留 flex 槽位，按钮保持固定 28×28 命中区。tooltip 绝对定位且不接收指针事件，不会使指针在 hover 边界振荡。
