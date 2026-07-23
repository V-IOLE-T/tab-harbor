# Tab Harbor v1.1.2

## 中文

Tab Harbor v1.1.2 现已发布。

更新：

- 新增完整配置备份与恢复。现在可以在设置中导出、导入主题、快捷链接及其自定义图标、已保存会话、待办、分组与排序、语言偏好、原生标签分组设置和抽屉位置等本地配置。
- 标签页工作区改为按浏览器窗口隔离显示与管理；多个窗口同时使用 Tab Harbor 时，各自只处理当前窗口的标签页。
- 首页与工具栏 popup 中的快捷链接现在都会直接打开新的激活标签页，不再替换 Tab Harbor 页面或跳回已有同网址页面。

修复：

- 修复标签页新建、关闭和导航后的工作区刷新稳定性，并静默处理没有接收方的运行时通知。
- 修复多窗口下原生 Chrome 标签分组同步可能影响其他窗口分组的问题。
- 修复批量恢复会话时遗漏仍在加载中的标签页，以及重复新标签识别对待加载 URL 的兼容问题。
- 同步仓库根目录和 `extension/` 入口的版本信息，保证两种加载方式均为 1.1.2。

下载：

Chrome Web Store: https://chromewebstore.google.com/detail/tab-harbor/bkjihmeifgjifhkleokclpobdfnhiodf?authuser=0&hl=zh-CN

GitHub 仓库: https://github.com/V-IOLE-T/tab-harbor

说明：

Chrome Web Store 提交使用官方要求的 `.zip` 包。

普通用户仍推荐优先通过 Chrome Web Store 安装正式版本。

## English

Tab Harbor v1.1.2 is now available.

Highlights:

- Added complete configuration backup and restore. Settings can now export and import local preferences including themes, quick links and custom icons, saved sessions, todos, groups and ordering, language preference, native tab-group settings, and drawer position.
- Tab workspaces are now isolated by browser window. When Tab Harbor is open in multiple windows, each workspace manages only the tabs in its own window.
- Quick links on both the dashboard and toolbar popup now always open a new active tab instead of replacing Tab Harbor or returning to an existing matching tab.

Fixes:

- Improved dashboard refresh stability after tab creation, removal, and navigation, while silencing expected runtime notifications with no receiver.
- Fixed native Chrome tab-group synchronization so it does not affect groups in other browser windows.
- Fixed batch session restores dropping still-loading tabs and improved duplicate new-tab detection for pending URLs.
- Kept version metadata aligned at both the repository-root and `extension/` entry points for 1.1.2.

Downloads:

Chrome Web Store: https://chromewebstore.google.com/detail/tab-harbor/bkjihmeifgjifhkleokclpobdfnhiodf?authuser=0&hl=zh-CN

GitHub repository: https://github.com/V-IOLE-T/tab-harbor

Notes:

The Chrome Web Store submission uses the official `.zip` package format.

Regular users should continue installing the production build from the Chrome Web Store.
