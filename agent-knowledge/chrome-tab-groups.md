# Chrome 标签组子系统

> Chrome 标签组写入只有一个所有者：background service worker 中的 `chrome-tab-groups-coordinator.js`。`automatic-tab-groups.js` 为 Dashboard 与 worker 提供同一套纯策略；普通事件同步不依赖 Dashboard 常驻。

## 三类状态

| 概念 | 说明 | 写入边界 |
|---|---|---|
| **逻辑组（logical group）** | 共享纯策略根据 tabs、设置与 live 原生组计算出的 `{groupKey,title,color,collapsed,tabIds}` desired 状态 | `collapsed` 只作为新建组初始值，不是持续同步目标 |
| **扩展创建组（origin=created）** | Coordinator 在无安全候选时通过 Chrome API 新建的原生组 | 扩展维护成员与 title/color；只在创建时应用初始 collapsed，停用同步时可解组 |
| **沿用组（origin=adopted）** | 用户原先已有、且满足唯一安全候选规则的原生组 | 只追加所需成员；绝不改外观或自动折叠，停用同步时不解组 |

未进入当前 session mapping 的其他原生 Chrome 组仍按用户组展示。`shared === true` 的 Chrome 组不能被 adopt 或 merge。

## 共享策略与后台事件驱动

`automatic-tab-groups.js` 是 Dashboard 与 service worker 共用的纯策略层，不调用 Chrome 写 API。

- 它归一化可恢复 tabs，计算落地页、自定义、域名和本地文件逻辑组，分析 live 原生组与 session mapping，并输出 `{windowId,preserveGroupKeys,groups,analysis}`。
- `background.js` 在 service worker 启动时只加载随包的 `config.js`、URL/icon helper、共享策略与 coordinator，因此即使没有 Tab Harbor 页面打开，普通标签变动仍可自动分组。
- `config.local.js` 只由 Dashboard 的 `config-loader.js` 作为可选私有覆盖加载，不进入 worker 的 `importScripts`。Dashboard 先把 hostname/path 等声明式字段发布到内部 local 快照，worker 据此持续对账；含函数 `test` 的规则只标记 dashboard-only，不序列化函数源码，后台自动 desired 写入暂停以避免规则争用。
- 启动、安装/升级、同步开关从非 true 变为 true，以及 tabs created/updated/removed/replaced/moved/attached/detached 会安排相关窗口同步；`onUpdated` 只关注 URL、groupId、pinned，窗口关闭中的 remove 不安排。
- 每个窗口持有独立调度槽，事件先 **275ms debounce**。运行前 burst 只保留一次完整 live snapshot；运行中事件只标记 dirty，该轮完成时至多安排一轮 trailing debounce。Coordinator 的全局队列仍负责跨窗口写入串行化。
- 每轮必须先取得有效且 background-safe 的规则快照，再依次成功读取该窗口 tabs 与 coordinator `get-state`，才会用共享策略构建并提交 sync。规则未初始化、损坏、含函数谓词，或 tabs/native-group 查询失败时都 fail-closed，不提交替代写入。

Chrome API 写入会反射为 tabs 更新或移动事件。按窗口 trailing 调度保留一次最终对账机会；coordinator 对已一致的 `created` title/color 跳过 `tabGroups.update`，两层共同使自写回声收敛。

Worker 注册依赖也是自动分组的可用性边界。所有同步 `importScripts` 必须存在于安装包；缺少任一必需 helper、共享策略或 coordinator 都应让启动 smoke 明确失败，不能用 `try/catch` 把缺失发行资源伪装成可选行为。

## 规范化主域名键

普通 HTTP(S) 标签的自动 `groupKey` 来自 `getPrimaryDomain(hostname)`，不是显示标题或原始完整 URL。

- hostname 先转小写并移除开头的 `www.`；常规子域归并到同一主域。
- 内置 `MULTI_PART_SUFFIXES` 覆盖的多段公共后缀会保留可注册域层级；已知多租户托管后缀保留租户 hostname，使不同租户保持隔离。当前实现不是完整 Public Suffix List，未收录后缀仍可能退化为末两段归并。
- 不同规范化主域必须产生不同 groupKey，即使 `friendlyDomain` 或 `groupLabelOverrides` 让它们显示同名，也不能自动合并或互相接管。
- Landing page、自定义规则和 `file:` 的 `local-files` 规则优先于普通主域名计算。

因此“按域名分组”指按规范化主域名键聚合，而不是按完整 hostname 切碎常规子域，也不是按可变标题识别所有权。

## created 跨域导航迁移

自动迁移权限只来自当前窗口 session mapping 中的 `origin=created`；URL 从主域 A 变为主域 B 不会关闭或替换标签。

- 共享策略以最新 URL 重新计算 B，并把仍位于旧 created A 组的 tabId 标记为可迁移成员，而不是把 A 永久加入 `preserveGroupKeys`。
- Coordinator 重新读取 live state 后才执行成员迁移。A 仍有同域成员时保留组与 mapping；A 为空时移除旧 mapping，空原生组由 Chrome 清理。
- B 侧仍执行正常的 mapping/candidate 预检：复用安全目标或创建一个新组，绝不因迁移绕过多候选、shared 或查询失败保护。
- 来源 mapping 为 `adopted`、标签属于 Tab Harbor 手动分组，或位于不受扩展所有的原生组时，不自动移出；这些情况保持 fail-closed。
- 迁移相关的标签、来源组、目标组或成员信息不完整时，该迁移零写入并保留 mapping；不能用猜测式 ungroup/group 修复。

迁移只改变标签组 membership 与相应 session mapping，不调用 `tabs.remove`，不改变标签 URL，也不把 adopted/manual 边界扩大为扩展所有权。

## 写入所有权与串行队列

- `background.js` 通过 `importScripts` 加载共享策略和 `chrome-tab-groups-coordinator.js`，并创建唯一 coordinator。
- Dashboard 使用受信 `chrome.runtime.sendMessage` 请求：`sync-chrome-tab-groups`、`merge-chrome-tab-groups`、`get-chrome-tab-group-state`。Background 将其映射为 coordinator 的 `sync`、`merge`、`get-state`。
- Coordinator 以一条全局 promise queue 串行执行所有窗口的 sync/merge/state 操作，避免多个 Tab Harbor 新标签页同时写 Chrome 原生组。
- 同一窗口尚未开始执行的多个 sync 会合并为最新 snapshot；每个调用者收到该轮结果。
- 每轮 sync 在首个写操作之前完成窗口组、窗口标签和逐组成员查询。全局 query 失败时本轮保证零写入；逐组 query 失败只冻结相关逻辑组。
- 排队操作开始执行时由 background 重读 `chromeTabGroupsEnabled`：设置已经关闭时把旧启用请求转换为全窗口关闭；设置仍开启时拒绝来自旧页面的关闭快照，避免过期页面改写新设置。
- Background 监听设置由 true 变为非 true，先持久化 `chromeTabGroupsCleanupPending=true`，再自行提交 `allWindows:true` 清理。成功后清除标记；失败按 1 秒起步、最高 30 秒退避，worker 启动、安装或后续 disabled 标签事件读取标记续做。Dashboard 仍会显示失败反馈并在看到残留 `created` mapping 时补充重试。

拖拽、批量移动、重命名、会话恢复、同步开关和显式合并等所有会改变 Chrome 标签组的路径，都必须遵守同一写入所有者约束。

## Coordinator API

`createChromeTabGroupsCoordinator({chromeApi, readSyncEnabled?})` 返回：

- `sync({windowId, enabled=true, allWindows?, preserveGroupKeys?, groups})`
- `merge({windowId, targetGroupId, sourceGroupIds, groupKey?, expectedGroups})`，用于用户确认的原生组合并；`expectedGroups` 是确认框打开时的外观与有序成员快照
- `merge({operation:'create'|'join'|'ungroup'|'update'|'reorder', ...})`，用于 Dashboard 的其他手动写入路径
- `getState({windowId?})`
- `dispatch({action:'sync'|'merge'|'get-state', ...payload})`

输入会先校验 window/group/tab id、重复 groupKey、同一 tab 是否被多个逻辑组声明、颜色与 collapsed 类型。失败返回结构化 `{ok:false,error:{code,message,details?}}`，不进入写入阶段。

## Session-only 映射

`chromeTabGroupsSessionMap` 存在 `chrome.storage.session`，格式是：

```text
{
  groupKey: {
    windowIdStr: { groupId, origin: 'created' | 'adopted' }
  }
}
```

- 原生 groupId 会随浏览器会话变化，因此映射按逻辑组和窗口记录，只用于当前会话协调所有权。
- 映射不是用户配置，不进入 `config-sync.js` 导出/导入。
- `chrome.storage.local.chromeTabGroupsCleanupPending` 只是关闭同步的恢复标记，也不进入配置导出；只有全窗口清理成功才清除，避免 worker 重启把一次瞬时失败误当完成。
- `chrome.storage.local.automaticTabGroupRuleOverrides` 是 Dashboard 派生的内部规则快照，也不进入配置导出；它只含声明式字段与 `backgroundSafe` 标记，不含函数源码。
- 旧 `chrome.storage.local.chromeTabGroupsMeta` 会被清理，不再用 title/color 持久指纹跨会话猜测归属。
- 映射中的 groupId 已消失时删除 stale entry，再按当前 live state 重新预检。
- Dashboard 只有 coordinator 的 `get-state` 成功后才持有 authoritative snapshot；只读 fallback query 可用于展示，但不能成为启用同步的写入依据。
- live 状态无法证明安全的 mapping 会进入 `preserveGroupKeys`，让 coordinator 保留并冻结它，而不是把 snapshot 缺项解释成应当解组或新建。

## 唯一安全候选与 adopt

一个原生组只有同时满足以下条件，才是某逻辑组的 adopt 候选：

1. 位于同一 Chrome window；
2. title 与逻辑组完全相同；
3. 不是 shared group；
4. 成员查询成功且组内非空；
5. 现有每个成员都在该逻辑组的 desired `tabIds` 中，也就是没有混入其他逻辑组的标签。

颜色不是 adopt 条件，因为 adopted 组必须保留用户原来的外观。

- **恰好一个候选**：记录 `origin=adopted`，仅把缺少的 desired tabs 加入该组。
- **多个候选**：返回 `multiple-candidates` conflict，不自动挑选、不新建重复组；UI 必须展示候选并取得用户确认后，才可发起显式 merge。
- **没有候选**：创建新组并记录 `origin=created`。
- 除已验证的 created 跨域导航迁移外，若 desired tab 已在不允许的其他原生组、候选含无关标签、group query 失败或标签失效/跨窗口/被 pin，则相关逻辑组冻结，不用猜测式写入修复。
- 已映射的 adopted 组若被用户改名也进入冻结状态并保留 mapping；扩展不会为了恢复匹配而改回用户标题，也不会创建替代组。
- 已有 mapping 不是忽略重复组的理由：若另一个同名组同样安全，mapped 分支也返回 `multiple-candidates`；候选按成员最小 tab index 排序供确认 UI 标注左右位置。

## adopted 与 created 的行为差异

### adopted

- Adopt/reuse 不调用 `chrome.tabGroups.update`，因此不修改 title、color 或 collapsed。
- 不参与自动折叠；用户自己的展开/折叠选择保持原样。
- 组内标签跨域导航不会授权自动迁出；状态保持 fail-closed，等待用户处理或之后重新取得安全 live state。
- 当逻辑组从 enabled sync snapshot 消失时，只释放 mapping，不解组原生标签。
- `enabled:false` 时不解组 adopted 原生组；session mapping 保留，重新启用时仍需以 live state 复核。

### created

- Coordinator 在首次创建时应用 desired title、color 和初始 collapsed，并维护成员。
- 后续 reuse/sync 只在 live 值有差异时更新 title/color 与成员，绝不为相同外观调用 no-op `tabGroups.update`，也不再写入 collapsed；用户在 Chrome 中手动展开或折叠的状态是实时真值。
- 组内标签从规范化主域 A 导航到 B 时，在 live 查询完整后自动迁入 B；标签不关闭，A 的其他同域成员与用户折叠状态保持不变。
- Dashboard 启动、窗口聚焦、页面可见性变化或聚焦某个标签时，都不再触发自动折叠/展开写入。
- 逻辑组不再需要或 `enabled:false` 时，先确认成员 query 成功，再解组其标签并删除 mapping。
- 若成员查询失败，保持原组与 mapping 为 frozen，避免在状态不完整时破坏用户标签。
- 关闭同步使用 `allWindows:true`：先全局识别存活窗口并预读所有将变更的组，再开始解组；已关闭窗口的 stale mapping 只修剪，不向无效 windowId 查询。

## 显式 merge

`merge` 只在用户确认后使用：

- payload 必须携带对话框打开时 target/source 的标题、颜色以及有序 tabId/URL 快照；执行前 live 状态与任一快照字段不一致都会拒绝合并；
- 校验 target/source 均存在于同一 live window、不是 shared、成员均可完整查询；
- 把 source tabs 加入 target group，保留 target 的 title、color 和 collapsed，不调用 `tabGroups.update`；
- 按合并前标签栏的 live index 对全部标签重排；
- 若 source/target 已映射到多个不同逻辑 groupKey，直接返回 mapping conflict；只有一个现有映射时，payload 中的 `groupKey` 必须与它一致；
- 合并成功后只保留 target mapping；target 原本由扩展创建时保持 `created`，否则记为 `adopted`。

## Dashboard 展示与事件

- 用户原生组仍通过 live query 渲染为 `__chrome_group__:<id>` 卡片，并按标签栏位置展示。
- 用户组卡片不写入持久化的 dashboard group order；原生位置仍由 Chrome live state 决定。
- Background `tabs-changed` 消息与 Dashboard 的直接 Chrome group/tabs 订阅都会过滤已知的其他窗口；事件不含可判定 windowId 时保守刷新当前页。
- Background 消息监听在首次异步加载前注册；启动或本地操作的 suppression 窗口只把通知延后到安静期结束，不会丢弃。两条事件路径共用一个 debounce timer，并只调用 `renderDashboard({syncChromeGroups:false})`。异步重绘期间到达的新事件只留下一个 dirty 标记，当前轮完成后至多追加一轮，避免并发重建卡片 DOM；普通事件也不会从 Dashboard 再提交自动同步。
- Conflict 是可展示状态，不应被转译成“没有组”或静默创建。多候选确认界面应列出 groupId、title、color、tabIds/位置等 live 信息。

## 验证边界

- 共享策略、worker 随包导入与启动、payload 校验、candidate/adopt/merge/session map、后台事件调度、只读刷新与失败零写可以在 Node mock API 测试中覆盖。
- `storage.session` 的真实生命周期、service worker 唤醒后的队列行为、Chrome 原生组事件顺序、权限/版本差异和用户确认交互，仍需在目标 Chrome 版本中真机验证。
- 不能用测试通过数替代真机结论；文档只记录已实现的契约和仍需验证的浏览器边界。
