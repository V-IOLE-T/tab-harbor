# 核心验收规范

本章定义新增行为的关键回归场景；Node mock 负责可重复的逻辑与 API 契约，真实 Chrome 负责浏览器生命周期和交互验证。

## 一言实例稳定验收

回归测试应保护 [[features#一言页面实例稳定性]]，证明当前文案在一份新标签页 document 的存续期间不被更换。

启动缓存为 A 时，首次渲染锁定 A；即使外部将缓存改为 B 或预热写入新值，重复同步仍显示 A，文本 DOM 也只写一次。每个实例只发起一次预热，且完成回调不写当前 DOM。

禁用功能时仍锁定启动缓存；同一实例开启、再禁用、再开启始终恢复该文案，不重读更新后的缓存，也不启动第二次预热。

启动时无缓存的实例在预热完成后仍保持隐藏；只有下一份新标签页 document 才能选取新缓存。静态渲染路径不得 await 网络请求。

`extension/hitokoto-lifecycle.test.js` 分别覆盖锁定后预热隔离、开关恢复同一条目和空缓存只供下一实例三个场景。

网络超时回归还必须证明 `fetchHitokoto()` 的同一定时器一直覆盖 `response.json()` 完成：成功与 fetch 拒绝后均只清理一次；响应 body 挂起时保持计时，到期中止请求、返回 `null` 并在 `finally` 清理。

## Chrome 标签组验收

标签组测试必须证明安全接管不产生重复组，并证明信息不完整时不会猜测式写入。

### 候选、接管与冲突

唯一同名、非 shared、成员全属同一逻辑组的原生组应被 adopted；多候选返回冲突，混合成员和 shared 组不自动接管。

没有安全候选时才创建新组；候选颜色不同不影响 adopted，且 adopted 后不得调用外观更新。

已有 `created` 或 `adopted` mapping 时出现第二个安全同名组，也必须返回 `multiple-candidates` 且零写入；候选顺序按实时 tab index，而不是 `tabGroups.query` 的返回顺序。

### 规范化主域名键

分组策略测试必须保护 [[features#Chrome 标签组协调#规范化主域名键]]，证明规范化只归并同一主域，不能因标题相同而混合不同主域。

`example.com`、`www.example.com` 与常规子域应得到同一 `groupKey`；不同主域必须得到不同 key 和 desired group，即使友好标题或标签覆盖相同也不得合并。

内置列表覆盖的多段公共后缀应保留正确可注册域层级，已知多租户托管后缀应保留租户 hostname；测试不得把当前手工列表描述为完整 PSL。Landing page、自定义规则与 `file:` 分组仍须先于普通主域名计算。

### Created 组跨域导航迁移

回归测试必须证明 [[features#Chrome 标签组协调#Created 组跨域导航迁移]] 只作用于扩展拥有的来源组，并在查询完整时把同一标签从 A 收敛到 B。

来源为 `created` 且标签从 A 导航到 B 时，最终 B desired group 必须包含原 tabId，A 不得因正常导航进入永久冻结；全过程不得调用 `tabs.remove` 或关闭标签。

A 仍有同域成员时只迁出已导航标签并保留 A mapping；A 已无成员时清理旧 mapping 和空组。B 已有安全目标时复用，否则只创建一个 B 组，不能产生重复组。

来源为 `adopted`、Tab Harbor 手动分组或不受扩展所有的原生组时应冻结并零写入。任一迁移相关标签、来源组、目标组或成员查询失败时，也必须保留现状与 mapping，且不执行 group/ungroup/update/move/remove。

Background 的 `tabs.onUpdated` URL 事件必须提交最新完整窗口快照；若 Chrome 写入产生事件回声，迁移仍应在有界 trailing 对账内收敛，而不是恢复到 A 或重复创建 B。

### Background 导航快照触发

后台回归必须证明仅靠 URL 更新事件就会用最新窗口和原生组状态提交跨域 desired snapshot，不依赖新建或打开 Tab Harbor 页面。

标签 URL 已从 `hellogithub.com` 变为 GitHub repo、但 live `groupId` 仍指向旧 `created` 原生组时，builder 输入必须同时包含新 URL、旧 groupId 和查询完整的旧 native mapping；随后 sync payload 只提交 `github.com` desired。

即使 `tabs-changed` 没有 Dashboard 接收者，`tabs.onUpdated` 仍须完成 `get-state` 与 sync 调度，不能等待另一个 Tab Harbor 新标签页初始化后才对账。

### 并发、会话与迁移

多个 Dashboard 并发同步时，同一窗口未执行快照只采用最新值，全局队列不并行写入，同一逻辑组只创建一个原生组。

会话映射记录 groupKey/windowId/groupId/origin；浏览器重启后不使用旧 windowId/groupId 身份，成功实时重建后清理旧 local metadata。

### 后台事件驱动与回声收敛

回归测试必须证明没有 Dashboard 接收者时后台仍会自动分组，并证明事件 burst、自写回声与多窗口不会放大成重复写入。

启动、安装/升级和同步开关启用应发现全部存活窗口；created/updated/removed/replaced/moved/attached/detached 应安排正确窗口，且 `onUpdated` 只在 URL、groupId、pinned 变化时同步，窗口关闭中的 remove 不安排。

同一窗口在 275ms 内的创建与最终 URL 更新只生成一份最新完整 snapshot；不同窗口保留独立 snapshot。运行中收到多个事件只在完成后安排至多一轮 trailing 同步，不丢真实用户事件。

禁用状态不得读取 coordinator 或写组；窗口 tabs 查询、native group 状态查询或策略 snapshot 失败时不得提交 sync。启动与安装路径在没有 Dashboard receiver 时也必须工作。

Coordinator 复用 `created` 组时，live title/color 与 desired 相同不得调用 `tabGroups.update`。Dashboard 的 background 消息监听须早于首次异步渲染，suppression 期间的通知应延后而非丢弃；两条事件路径应过滤已知其他窗口、共用一个 timer，并仅执行 `renderDashboard({syncChromeGroups:false})`。首轮未完成时的新通知不得并发渲染，只能留下至多一轮尾随刷新。

### 自定义规则快照

回归必须证明 [[features#Chrome 标签组协调#自定义规则一致性]] 不会让 Dashboard 与 worker 使用两套规则反复拆组。

声明式 landing/custom 规则应在 Dashboard 原生组同步前发布，并原样进入 background builder。快照缺失、损坏或标记 `backgroundSafe=false` 时，普通后台轮次不得读取 coordinator 或提交默认 desired 写入；Dashboard 的受信显式请求仍可执行。

函数型 landing 规则不得把函数源码写入 storage。清空本地覆盖并发布安全空快照后，后续后台事件可恢复默认持续对账；内部规则键不得进入配置导出。

### Worker 发行启动完整性

启动 smoke 必须证明 [[architecture#Service worker 发行闭包]] 中每个实际导入都存在并可按生产顺序求值，缺少必需资源时则明确失败。

正向场景使用真实 `background.js` 和真实依赖，严格解析每次 `importScripts`：导入序列只能是 `config.js`、`icon-utils.js`、`tab-url-utils.js`、`automatic-tab-groups.js`、`chrome-tab-groups-coordinator.js`，且不得请求 `config.local.js`。

完整启动后，共享 snapshot builder、coordinator factory 与 background 自动同步入口必须存在，顶层脚本之间不得发生全局绑定冲突。

负向场景模拟发行包缺少 `automatic-tab-groups.js`，启动必须以该路径的明确错误失败；测试不得由 worker 内部捕获缺失资源后继续注册。

### 查询失败与关闭同步

全局 `tabGroups.query` 或窗口快照失败时本轮零写入；单组成员查询失败时，受影响逻辑组冻结并保留映射。

Dashboard 状态查询失败时不得用只读 fallback 快照发起启用同步；不安全映射应保留。执行排队请求时若后台设置已变化，过时启用请求必须零写入。

关闭同步须覆盖所有存活窗口，并在首个写入前完成受影响窗口的读取；只解组 `created`，`adopted` 组和其会话映射保留，不解组、不改外观。已关闭窗口的过期映射不会阻断清理。

设置关闭事件应由 background 在写入持久化 pending 标记后主动提交清理；失败响应必须保留关闭状态与 pending 标记并安排退避重试。模拟 worker 内存重置后的 startup/install 或 disabled 标签唤醒必须续做；成功清除标记后，后续 disabled 事件不得重复查询 coordinator。页面看到残留 `created` 映射时仍可再次尝试，不能把一次查询失败当作完成。

### 确认合并

合并必须在执行前重读 target/source，拒绝缺失、跨窗口、shared、成员查询不完整或多逻辑映射冲突。

确认载荷必须包含对话框打开时的组标题、颜色以及有序 tabId/URL 快照；任一字段变化均应 fail-closed。成功合并不关闭标签，保留目标组外观，并按原 live index 恢复顺序；结果映射只指向目标组。

### 初始折叠与用户状态

新建 `created` 组时应一次性写入 desired 初始 collapsed；后续 reuse/sync 不得携带 collapsed 更新，用户手动展开或折叠后的 live 状态必须穿过之后的同步。

`adopted` 组在接管和复用时都不得调用外观更新；其标题、颜色和 collapsed 持续以 Chrome live state 为准。

Dashboard 启动、窗口 focus、页面 visibility 变化和搜索结果聚焦标签都不得自动折叠或展开任何原生 Chrome 组。

## 书签镜像验收

书签测试覆盖可选权限、不同树形、实时刷新和打开修饰键，并确认实现从不调用书签写 API。

### 权限与状态

未授权时只显示明确 CTA，搜索不弹权限；授权、拒绝、重试、撤销权限、空书签栏和 API 失败各有可区分状态。

文件夹标记存在时优先选择 `bookmarks-bar`，字段不存在时选择根节点第一个文件夹，不依赖硬编码 ID 或标题。

### 树导航与实时更新

多根节点、空树、深层文件夹、重复 URL、中文标题和大量书签不应破坏面包屑、文件夹原位导航或全树搜索。

创建、修改、移动、删除、重排和导入结束事件应 debounce 刷新；当新请求超越旧请求时，generation token 必须丢弃旧结果。

当 `getTree` 延迟期间用户输入新搜索词，无论 debounce 搜索先于或晚于树返回，最终输入和结果都必须属于新词；树刷新不得恢复启动时的旧 query。

全量重绘后须恢复仍适用的搜索焦点和选择区间；进入文件夹时聚焦新内容，空文件夹回退到书签搜索。Escape 返回父级或关闭面板后，焦点应回到稳定入口。

权限按钮、清除搜索和重试触发状态重绘后，焦点也须回到新的同类操作或书签搜索；同名结果的可访问名称应带文件夹路径或 URL 作为区分信息。

### 纵向列表与书签 favicon 偏好

顶层、文件夹和搜索视图都应是单列纵向列表，使用 `overflow-y:auto` 且 `overflow-x:hidden`；长标题、中文、大量书签和窄屏均不依赖横向滚动。

`bookmarksShowFavicons` 必须严格布尔、默认 false，由“桌面设置 → 功能”开启并随 `themePreferences` 持久化/导入导出。关闭时书签架和统一搜索都不解析书签 favicon；开启时两处只接受 Chrome `_favicon` URL，失败不得转向站点或第三方网络 fallback。

开关切换应通过 controller 原地重绘根目录/文件夹/搜索视图的叶子行，不重新请求书签权限、不重读书签树；文件夹图标始终保持安静符号。

### 打开修饰键与危险 URL

普通点击导航当前页，Ctrl/Cmd 或中键创建后台标签，Shift 创建新窗口；Chrome 内部 URL 失败时显示反馈而不修改书签。

`javascript:`、`data:` 和 `vbscript:` 必须在导航前阻止，且不暴露到顶部搜索索引；其他语法有效的 URL 必须交给 Chrome，打开失败时显示反馈。

## 统一搜索验收

搜索测试将纯函数的来源组装与 Dashboard 的 combobox 契约分开验证，便于在 Node 中稳定覆盖数据优先级。

### 优先级、去重与会话展开

相同 URL 同时出现时，必须按 tab > shortcut > bookmark > session > history 选择唯一结果；书签 folderPath 参与搜索匹配。

保存会话的直接 tabs、`window.tabs`、`windows[].tabs` 和兼容包裹结构都应展开，再与高优先级 URL 去重。

### 组合框、键盘与触屏

输入框必须暴露 combobox、listbox 引用、稳定 option ID 和当前 `aria-activedescendant`，结果切换时同步 `aria-selected`。

ArrowUp/ArrowDown 循环选择，Enter 激活，Escape 关闭并恢复焦点；点击、中键与触屏都能在不依赖 hover 的情况下激活结果。

## 打开标签行几何稳定验收

回归测试应保护 [[features#打开标签行几何稳定性]]，确保 hover/focus 反馈不导致位移、命中区变化或按钮重排。

`.mission-card:hover`、`.page-chip.clickable:hover` 和 `.chip-action:hover` 不得设置 display、尺寸、内外边距、边框宽度或 transform。测试同时要求动作槽为不收缩 flex、按钮 28×28，tooltip 为绝对定位且不接收指针事件。

## 验证边界

`node --test extension/*.test.js` 覆盖纯逻辑、模拟 Chrome API、manifest、搜索和 UI 回归；通过数不应写入长期架构文档。

以上 Node 测试不能代替真实 Chrome 中的 service worker 唤醒、`storage.session` 重启生命周期、权限弹窗、原生组事件顺序、键盘/触屏和窄屏/暗色主题验证。
