# 扩展运行时架构

Tab Harbor 是 Manifest V3 扩展：Dashboard 使用有序普通脚本，background service worker 独占 Chrome 标签组写入，两者通过受校验的内部消息协作。

## Dashboard 有序脚本

Dashboard 没有 bundler 或 ESM，`extension/index.html` 中的 `<script>` 顺序是运行时契约；共享分组策略位于其 helper 之后，书签模型先于书签架加载，`app.js` 继续作为薄入口。

`automatic-tab-groups.js` 位于 `tab-url-utils.js` 之后，为 Dashboard 暴露纯策略命名空间。`bookmarks-model.js` 与 `bookmarks-shelf.js` 也使用 IIFE 挂载命名空间，避免顶层绑定冲突。详见 [[features#只读书签镜像]]。

## 共享自动分组策略

`automatic-tab-groups.js` 统一 Dashboard 与 worker 的逻辑组定义、原生组分析和 desired snapshot，且不直接调用 Chrome 写 API。

策略根据可恢复 tabs、手动分配、标签顺序、标题覆盖和 live 原生组计算 `{windowId,preserveGroupKeys,groups,analysis}`。页面脚本按有序 `<script>` 使用它，worker 则在启动时用 `importScripts` 加载同一文件。

## Service worker 发行闭包

Worker 注册阶段只允许同步导入安装包内确定存在的脚本，不能请求缺失的可选资源再依赖 JavaScript 异常恢复。

`background.js` 按顺序导入 `config.js`、`icon-utils.js`、`tab-url-utils.js`、`automatic-tab-groups.js` 与 `chrome-tab-groups-coordinator.js`；这些文件共同构成 worker 的发行闭包。

`config.local.js` 被 gitignore 且不属于发行包，只由扩展页面的 `config-loader.js` 可选加载。Dashboard 将声明式字段发布到内部 `automaticTabGroupRuleOverrides` 快照，worker 从存储读取而不在注册阶段请求私有文件或执行存储代码；含函数谓词的快照标记为 dashboard-only。

## 后台标签组写入所有权

`background.js` 从完整的 [[architecture#Service worker 发行闭包]] 加载共享策略与唯一 coordinator，使后台自动同步、Dashboard 显式同步、手动变更、状态查询和合并进入同一条串行队列。

`extension/chrome-tab-groups-coordinator.js` 管理全局 promise queue，同一窗口尚未执行的多份 sync 快照只保留最新一份。Dashboard 侧的 `chrome-tab-groups-sync.js` 只做页面适配并发送请求，不成为第二个写入所有者。

Coordinator 对 `created` 组比较 live title/color，仅在值变化时调用 `tabGroups.update`；collapsed 仍只在首次创建时写入。无变化时跳过 API 调用，避免产生无意义的自写事件回声。

Coordinator 在排队操作真正执行时重新读取 `chromeTabGroupsEnabled`。已经过时的启用请求不得写入；已关闭的设置会被提升为全窗口清理，并在首个变更前完成所有仍存活窗口的读取。

Background 还监听该设置从启用变为关闭，并在提交全窗口清理前写入内部 local 标记 `chromeTabGroupsCleanupPending=true`。成功后才清除标记；失败按上限 30 秒退避重试，worker 启动、安装或后续 disabled 标签事件会读取标记续做，因此 Dashboard 不是唯一清理执行机会。

## 后台事件驱动同步

自动标签组无需 Dashboard 常驻；service worker 按窗口吸收普通 tabs 事件，并在完整 live 读取成功后才提交 desired snapshot。

启动、安装/升级、同步开关启用，以及 tabs created/updated/removed/replaced/moved/attached/detached 会安排相关窗口同步。`onUpdated` 只处理 URL、groupId 或 pinned 变化，窗口关闭中的 remove 不安排。

每个窗口独立 **275ms debounce**。运行前的 burst 合并为一次完整快照；运行中事件标记 dirty，并在本轮结束后至多安排一轮 trailing debounce。不同窗口的最终写入仍由 coordinator 全局串行。

每轮先读设置和规则快照。快照未初始化、损坏或为 dashboard-only 时自动 desired 写入 fail-closed；有效声明式快照才继续读取窗口 tabs，并用 coordinator `get-state` 取得原生组状态。任一查询失败或策略结果不合法都不调用 sync，不把缺失信息解释成空组清理。

Dashboard 在首次异步加载前注册 background 消息监听。启动或本地操作的 suppression 窗口只延后通知，不丢弃；Background 通知与直接监听按已知 windowId 过滤并共用一个 timer。事件回调只执行 `renderDashboard({syncChromeGroups:false})`；重绘期间的新事件合并为至多一次尾随刷新，不并发重建标签 DOM。未知窗口事件仍保守刷新，但不重复提交自动写入。

## 内部消息边界

Dashboard 只能以 `source: "dashboard"` 发送三类消息，background 重新校验发送者与 payload，并在首次写入前重读 Chrome 实时状态。

- `sync-chrome-tab-groups` → `sync`
- `merge-chrome-tab-groups` → `merge`
- `get-chrome-tab-group-state` → `get-state`

[[extension/background.js#handleChromeTabGroupsMessage]] 拒绝非扩展来源或缺少 Dashboard 标识的请求。`merge-chrome-tab-groups` 同时承载用户确认合并和 create/join/ungroup/update/reorder 手动操作，但写入仍只在 coordinator 发生。

## 状态与迁移

扩展配置保存在 `chrome.storage.local`，可变的原生 groupId 归属只保存在 `chrome.storage.session`，Chrome 书签树则只作为 API 数据源留在内存。

`chromeTabGroupsSessionMap[groupKey][windowId] = { groupId, origin }`，其中 `origin` 为 `created` 或 `adopted`。旧 `chromeTabGroupsMeta` 在一次成功实时重建后清理，不再写入也不进入配置导出。

`chromeTabGroupsCleanupPending` 是 background 的派生恢复标记，不属于用户配置且不进入配置导出。它只在关闭同步的全窗口清理成功后变回 false；浏览器重启不应丢失未完成清理。

`automaticTabGroupRuleOverrides` 同样是内部派生状态，不进入配置导出。Dashboard 在第一次原生组同步前发布；声明式规则可供后台持续使用，函数源码永不存储，含函数的本地规则只允许 Dashboard 显式提交完整 desired snapshot。

Dashboard 只有在 coordinator 状态查询成功时才把标签组快照视为可写依据；查询失败时仍可只读展示 Chrome 原生组，但启用同步必须停止。无法安全验证的现有映射通过 `preserveGroupKeys` 冻结，避免缺失快照触发替代组或解组。

## 隐私与权限边界

`bookmarks` 是可选权限，只能由书签架中的明确按钮请求；顶部统一搜索只消费已授权后的内存索引，不会触发权限弹窗。

书签功能不创建、编辑、移动、重排或删除 Chrome 书签，书签树不复制到 `storage.local`，也不进入配置导出。
