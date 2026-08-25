# Tab Harbor

[English](README.md) | [简体中文](README.zh-CN.md)

**一个更安静的新标签页工作台，把打开中的标签、Chrome 书签、快捷链接、已保存会话和轻量待办收进同一个顺手的空间里。**

Tab Harbor 会把 Chrome 的新标签页变成一个可以继续工作的地方。你会先看到自己现在到底开了什么、哪些内容适合稍后保存成会话、还有哪些事情还没处理完。

<p align="center">
  <img src="assets/readme/feature-bookmarks.png" alt="Tab Harbor 标签分组与 Chrome 书签工作台" width="760">
</p>


## ✨ 核心亮点

- **标签页按域名自动整理。** Tab Harbor 会按域名整理打开中的页面，把首页型标签单独收到 `Homepages` 分组里，让你先看清自己到底在处理什么。
- **自动分组之外，你也还能按自己的工作流继续整理。** 当域名分组不够用时，你可以创建手动分组、保留常用的 quick links，并通过顶部图标很快跳回需要的区域。
- **你愿意时，Chrome 书签也可以留在桌面上。** 书签权限是可选的，只会在你明确点击**显示书签**按钮后请求。书签架是 Chrome 书签栏的只读视图：Tab Harbor 不会把书签树复制进扩展存储，也不会把它放进配置导出。
- **已保存的标签页现在更像会话。** 你可以选择要保存哪些内容、把标签页加进已有会话、之后再恢复回来，也可以把会话折叠起来，让概览更干净。
- **待办一直在身边，但不会太吵。** 抽屉里可以新建、编辑、删除、搜索和归档待办，不用离开页面。
- **它尽量让工作台更安静，但不让系统更重。** 你可以切换主题、调透明度、调整文字和快捷链接大小、换背景图、让不活跃标签进入睡眠，也可以一键清理重复标签页；扩展自己的状态仍只使用 Chrome 的本地/会话期扩展存储，不需要服务器也不需要账号。

## 🖼️ 功能展示

<table>
  <tr>
    <td width="33.33%" valign="top">
      <strong>标签与书签</strong><br><br>
      <img src="assets/readme/feature-bookmarks.png" alt="按域名分组的标签页与 Chrome 书签" width="100%">
    </td>
    <td width="33.33%" valign="top">
      <strong>已保存会话</strong><br><br>
      <img src="assets/readme/feature-saved-drawer.png" alt="已保存会话抽屉" width="100%">
    </td>
    <td width="33.33%" valign="top">
      <strong>待办和跳转</strong><br><br>
      <img src="assets/readme/feature-todos.png" alt="待办" width="100%">
    </td>
  </tr>
</table>

### 标签页统一管理

Tab Harbor 会把标签页整理成更像工作区的结构：**按域名分组、支持手动分组、保留快捷入口，并且能从顶部图标快速跳回对应区域**；想把浏览器收拾利落一点时，**也可以一键清理重复标签页**。

原生 Chrome 标签组的写入由后台 service worker 串行协调。Dashboard 首次完成分组规则快照初始化后，普通标签的创建、跳转、移动和关闭，以及扩展安装或更新、浏览器启动和开启同步，都会触发后台按窗口重新核对；即使没有打开 Tab Harbor 页面也会运行。普通页面使用内置的规范化域名解析器作为分组身份：同一主域的常规子域归并，不同主域（例如 `hellogithub.com` 与 `github.com`）始终分开；标签跨域跳转后也会从 Tab Harbor 自建的旧组迁入正确的新组。解析器覆盖常见多段后缀和已知多租户站点，但不是完整的 Public Suffix List。同步时，如果只找到一个安全的同名原生组，并且它现有的标签都属于同一个逻辑组，Tab Harbor 会沿用它，而不是再创建一个重复组；若匹配到多个候选，则不会自行猜测，合并前需要你确认。Tab Harbor 自建组只在首次创建时应用初始折叠状态，之后的同步会保留你手动展开或折叠的选择。被沿用的原生组会保留自己的标题、颜色和折叠状态，不会被自动折叠，关闭同步时也不会被解组。

### 已保存会话

那些“现在先不看，但之后一定要回来”的页面，可以**先保存成会话、加入已有会话、之后再恢复，或者折叠起来保留一个更安静的概览**。

### 待办和跳转

除了整理标签页，你还可以在这里顺手记下待办、补一点简短说明、归档完成项，并从顶部图标快速回到当前任务相关的分组。

### 切换主题

想让它更像你自己的工作台时，可以**切换主题、调透明度、调整文字和快捷链接大小、换背景图**。在**桌面设置 → 功能**里，你可以选择搜索框使用的**搜索引擎**（浏览器默认、Google、Bing、Baidu、Sogou、DuckDuckGo、Brave、Yandex 或自定义 URL），也可以选择**在新标签页上**点击快捷链接时是**在新标签页打开**还是在**当前标签页打开**，以及书签行是否显示**网站 favicon**。书签 favicon 默认关闭，该选择与其他桌面偏好一样保存在本地。在**桌面设置 → 外观**里可以把快捷链接固定为每行 **4 列或 5 列**（竖屏保持自动），让每个链接的位置稳定不变。

### 搜索，一上来就有方向

搜索框会在 Tab Harbor 标签页回到前台时自动获得焦点，**新标签 → 输入 → 回车**全程无需点击。开始输入时会出现内联建议，来源包括**打开的标签页、快捷链接、Chrome 书签（授权后）、已保存会话和最近的浏览历史**。选中打开的标签页会直接切换过去（Ctrl/Cmd 点击则打开副本）；书签沿用下文的当前页、后台标签和新窗口语义，其他目的地在新标签页打开。方向键、回车和 Esc 都可以用。面板在你输入之前保持安静，不会打扰桌面。

### 由你决定是否启用 Chrome 书签

书签架会镜像 Chrome 的书签栏，但不会建立第二份书签数据库。它会优先使用 Chrome 标记为 `bookmarks-bar` 的文件夹；如果浏览器没有提供这个标记，则回退到浏览器书签根节点下的第一个文件夹。顶层书签、文件夹和搜索结果统一使用紧凑的单列纵向列表，便于扫读；面包屑用于原位浏览深层文件夹。Chrome 书签事件只用于在内存中保持视图更新。Tab Harbor 不会新建、重命名、移动或删除书签。

普通点击会在当前新标签页打开书签；Ctrl/Cmd 点击或中键会在后台标签页打开，Shift 点击会新建窗口。Tab Harbor 会阻止 `javascript:`、`data:` 和 `vbscript:` 书签 URL；其他语法有效的 URL 会交给 Chrome 打开，若 Chrome 无法打开，书签架会显示反馈。

这个书签架可以替代原生**书签栏的日常入口**，因此你可以自行隐藏 Chrome 的书签栏。它不会隐藏 Chrome 的标签页栏：普通扩展无法移除或隐藏这块由浏览器控制的界面。

<table>
  <tr>
    <td><img src="assets/readme/theme-warm-neutral.png" alt="warm neutral" width="100%"></td>
    <td><img src="assets/readme/theme-soft-green.png" alt="soft green" width="100%"></td>
  </tr>
  <tr>
    <td><img src="assets/readme/theme-soft-clay.png" alt="soft clay" width="100%"></td>
    <td><img src="assets/readme/theme-custom-background.png" alt="custom background" width="100%"></td>
  </tr>
</table>

### 手动睡眠控制

当你想让某个标签页先“睡一会儿”，又不想真的丢掉它时，可以**直接把单个标签页或整个分组放进睡眠状态**。

## 🌊 为什么它用起来不一样

很多新标签页产品想做的是搜索框、壁纸页，或者更漂亮一点的快捷方式面板。Tab Harbor 更像一个很轻的浏览器控制台。它不会假装你没有开很多标签页，而是承认这种混乱就是现实，然后把它整理成更能工作的样子。

这也是它为什么尽量保持轻。没有后端，没有同步账号，也不需要你再开一个单独应用。所有混乱本来就发生在浏览器里，那它就直接在那里帮你收拾。

## ⚡ 快速使用

### 从 Google 应用商店安装

1. 打开 Tab Harbor 的 Chrome 应用商店页面：

   [在 Chrome 应用商店打开 Tab Harbor](https://chromewebstore.google.com/detail/tab-harbor/bkjihmeifgjifhkleokclpobdfnhiodf?authuser=0&hl=zh-CN)

2. 直接从商店安装。
3. 在 Chrome 里打开一个新标签页。

由于商店版本需要打包审核，实际版本会稍微延后一点。

### 用 coding agent 安装

1. 把这个仓库地址给你的 coding agent：

   ```text
   https://github.com/V-IOLE-T/tab-harbor
   ```
2. 让它帮你安装扩展
3. 在 Chrome 里打开一个新标签页

### 手动安装

1. 克隆仓库：

   ```bash
   git clone https://github.com/V-IOLE-T/tab-harbor.git
   ```
2. 打开 `chrome://extensions`
3. 开启 **Developer mode**
4. 点击 **Load unpacked**
5. 在 Chrome 里选择 [`extension/`](extension/) 文件夹，Edge 里可直接选仓库根目录
6. 打开一个新标签页

## 🔒 完全本地

Tab Harbor 完全运行在扩展内部。打开中的标签页直接来自 Chrome，已保存会话、Todos、Quick links、主题偏好和布局状态都留在你自己的机器上，通过 `chrome.storage.local` 保存。Chrome 标签组与窗口的归属映射只保存在 `chrome.storage.session`，不会进入配置导出。若你启用了可选的书签权限，书签树只会从 Chrome 读入内存，用于书签架和搜索；它不会被复制进扩展的本地存储，也不会被导出。

如果你把这个仓库发到 GitHub 给别人用，他们拿到的是代码和资源文件，不会带上你的个人浏览数据。

## 🛠️ 底层

这是一个 Manifest V3 的 Chrome 扩展，前端结构很轻，使用时也不需要 build step。你可以直接 clone、直接加载、直接开始用，不需要 npm，不需要 dev server，也不需要先把别的东西跑起来。

## 🙏 致谢

- Tab Harbor 基于 Zara 的开源项目 [tab-out](https://github.com/zarazhangrui/tab-out) 继续发展，它也是本项目的上游仓库和最初出发点。
- 感谢 [Linux.do 社区](https://linux.do) 提供的灵感、反馈和很有生命力的开源氛围，让这个项目能持续往前长。

## 📄 License

MIT License
