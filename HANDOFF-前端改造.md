# HANDOFF-前端改造.md — 交给 DeepSeek Harness 的任务书

> 写给 DeepSeek Harness（你就是这张设计图的作者）。本文自包含，照着做即可。
> 生成时间：2026-10-07 02:15
> 交接人：WorkBuddy（AI 助手）｜用户：李姝涵（冰冰）

---

## 0. 一句话状态

三页改造（发现页 / 今日快讯页 / 行程票夹）**代码已写完**，但**发现页海报用的图尺寸不对**，
另有 4 项小任务未做。海报图是你生成的，需要你重出一张竖版图。

---

## 1. 工程信息

| 项 | 值 |
|---|---|
| 工程根（也是微信开发者工具工程目录） | `C:\Users\Lenovo\WorkBuddy\2026-09-29-21-33-32\four-seasons-journey-main` |
| 设计稿（**动手前必须完整读一遍**） | `C:\Users\Lenovo\WorkBuddy\2026-09-29-21-33-32\mockups\final-design-3pages.html` |
| 设计稿配图 | 同目录 `final-design-3pages.png`、`final-design-3pages-notes.png` |
| AppID | `wx168d052d2db78132` |
| `miniprogramRoot` | `miniprogram/`（已正确，不要改） |
| Git 远端 | `git@github.com:Bing-123456/four-seasons-journey.git`（SSH，已配好免Token） |
| 当前分支 | `main`，最新提交 `ad7927c`，工作区干净 |

**读设计稿的重点**：第一部分 7 屏定稿、第二部分 视觉规格与跳转表、第三部分 施工清单、第四部分 验收清单。

---

## 2. 铁律（违反即返工）

1. **`server/` 目录绝对不许动**。一行都不许改。这次任务全部是前端。
2. **不许往主包新增图片**。主包现在 1554KB，微信硬线 2048KB。大图一律上传云存储，再把fileID 填进 `miniprogram/lib/cloud-images.js`。
3. **不许写死本地路径**（`/assets/xxx.jpg`）——大图已移出主包，写了就是空白。
4. **不许用 `getTempFileURL` 的临时 HTTPS 链接**（约 2 小时过期）。要填就填 `cloud://` fileID。
5. **字号必须写成 `calc(Nrpx * var(--fs-scale, 1))`**，不许裸写 `font-size: Nrpx`（`tests/font-scale.test.js` 会卡）。
6. **任何新页面必须在 wxml 加全局 `<demo-notice id="demo-mode-notice"/>`**（`tests/ui-regressions.test.js` 会查）。
7. **新文案走 `miniprogram/lib/i18n.js` 词典**，不许把中文硬写在 wxml 里；**不许改已有键的含义**。
8. **不许自行发挥设计**。设计稿没写的地方不要自己发明。
9. **不要新增任何知识内容**，不许出现"滞销""帮了多少斤"这类数字。

---

## 3. 动手前必须先跑的三个检查

在工程根 `four-seasons-journey-main/` 下执行。这是基线，改坏了要能对比出来。

```bash
node --test tests/*.test.js          # 预期：485 过 / 4 失败（4 个是行程页老问题，见 §8）
node scripts/measure-package.js      # 主包体积，预期 1554KB / 2048KB
node scripts/check-refs.js           # 扫悬空引用，预期「零悬空路径」
node scripts/check-wxml.js# 扫 wxml 标签闭合，预期「38 个全部正确闭合」
```

> 这三个脚本是上一轮专门加来排查开发者工具报错的，**不要删**。开发者工具只会抛 `ENOENT` / "编译 .wxml 文件错误" 而不给行号，靠它们定位。

---

## 4. 【任务 1 · 最高优先】发现页海报：重出一张竖版图

### 4.1 问题诊断（已实测，不用你再查）

| 对象 | 实测尺寸 | 比例 |
|---|---|---|
| 现用主图 `orchard-garden-banner.jpg` | **768 × 404** | **1.90（横图 16:9）** |
| 手机屏（设计稿基准 iPhone X） | 375 × 812 | 0.46（竖屏） |
| 本地兜底底图 `orchard-garden-banner-bg.jpg` | 480 × 615 | 0.78 |

**一张横着进来的图塞进竖着的屏幕，必然不对。** 现状两种mode 都难看：
- `aspectFit` → 整图完整显示，上下留两块空白（用模糊底图填），观感像"图压在纸上"
- `aspectFill` → 上下铺满，但**左右各裁掉约 37%**，只剩中间 26%，构图废掉

**根因不是 CSS 写错，是图不符合规格。** 设计稿第 728 行早就写了：

> **新做图请按竖版规格**：画幅竖版 3:4 或 9:16；导出 **750×1624**（2倍图）或 1080×2340

设计稿第 726行的警告也在旁边：

> 16:9 横图 + 竖屏 + aspectFill → 左右各裁约 37%，构图基本废掉 → **别这么干**

所以：**重出一张竖版图，不要去迁就横图改版式。**

### 4.2 你要做的

**第一步 · 出图**

按设计稿「四、新图规格」那一节出图：

| 项 | 要求 |
|---|---|
| 画幅 | 竖版 3:4 或 9:16 |
| 导出 | **750×1624**（2 倍图）或 1080×2340 |
| 内容 | **图中不要有文字**（文字由页面叠上去，缩放后会打架） |
| 安全区 | 主体居中；**左右各留 12% 空白，上下各留 15%**，防止被裁或压到标题 |
| 格式体积 | JPG，质量 80–85，单张 **≤ 250KB** |
| 风格 | 与现有首页插画同体系（国潮插画 / 实际果园照片都可），低饱和、暖调 |
| 画面延续 | 柿子梯田、远山村落、梯田果树这一构图继续保留（与现图同一场景，只是改成竖构图） |

图保存到：`miniprogram/assets/illustrations/orchard-garden-banner.jpg`
（会覆盖旧图。覆盖前先确认新图确实是竖版再传。）

**第二步 · 上传云存储**

工程里已有生图/上传链路 `server/image-provider.js`（DashScope + Qwen Image Edit Max）。
云存储路径前缀（**注意 bucket 段是 `636c`，不是 `636`**）：

```
cloud://cloud1-d5gcgaukz8cb3f907.636c-cloud1-d5gcgaukz8cb3f907-1499093335/assets/orchard-garden-banner.jpg
```

上传后把控制台给的 fileID 填回 `miniprogram/lib/cloud-images.js` 第 23 行。

**第三步 · 改代码（两处，很小）**

`miniprogram/pages/index/index.wxml` 第 25–26 行：

- 竖版图铺满即可，**删掉 `.poster-image-bg` 那一层**（竖版图不再需要底图兜底）
- 主图 `mode` 从 `aspectFit` 改成 `aspectFill`
- `binderror="onPosterError"` 可以保留（真机网络异常时仍需要），此时 `index.js` 里的回退逻辑要改成回落到 `poster.imageBg`；若 `imageBg` 也不需要了，就把`onPosterError` 一起删干净

`miniprogram/pages/index/index.wxss` 第 26–35 行：

- 删掉 `.poster-image-bg` 与`.poster-image-main` 的 transform 相关样式（不再需要放大防黑边）
- `.poster-veil`、`.poster-copy`、`.poster-title` **保留不动**（这三块是对的，压暗层 + 左下角主标题已验收通过）

**注意**：`index.wxss` 第 26 行的 `.poster-region` 高度计算式
`height:calc(100vh - 400rpx - 58px - calc(132rpx + env(safe-area-inset-bottom)))` **不要动**。
之前踩过坑：小程序 `swiper` 用 `flex:1` 会高度塌成 0，现在改成普通 view 才是对的。

### 4.3 验收

- 满屏海报**四周没有黑边、白边或缝**
- 主图是**清晰的**（不是那张 7KB 的模糊底色）
- 左下角两行米白色大字完整可读、不被 tabbar 压住
- **静置 10 秒图不变**（已经不做轮播了）
- **点海报不弹任何预约表**（预约功能已按用户要求整体删除）

---

## 5. 【任务 2】发现页抽屉：「快讯」段接上跳转

**现状**：快讯页 `miniprogram/packageMore/news/news` 早已建好并已在 `app.json` 的 `packageMore` 分包注册，
但发现页抽屉那一行还是**不可点的静态占位**。

要改两处：

1. `miniprogram/pages/index/index.wxml` 第 78 行：把
   `class="drawer-row drawer-row-static" data-seg="news"` 改成
   `class="drawer-row" data-seg="news" bindtap="openDrawerSeg" role="button"`
   （去掉 `drawer-row-static` 这个"变灰不可点"的类）

2. `miniprogram/pages/index/index.js` 第 **155** 行（在 `openDrawerSeg` 函数内，该函数从第 146 行开始）的
   `seg === 'news'` 分支现在是 `this.setData({ drawerOpen: false }); return;`
   → 改成 `wx.navigateTo({ url: '/packageMore/news/news' }); return;`

**注意**：这一改会让 `tests/discover-blank.test.js` **第 80 行**那条断言失效
（它断言快讯段本轮不绑定跳转，因为当时页还没建）。改完请同步更新那条测试的注释与断言。

---

## 6. 【任务 3】今日快讯页：支持发多条，不再限 2 张

**用户原话**：「以后快讯要支持多条」。

现状 `miniprogram/packageMore/news/news.js` 第 106 行硬编码 `.slice(0, 2)`，
第 5 行注释也写了「最多 2 张」。

要做：
1. 去掉 2 条上限，或改成一个明确的常量（比如 20）并把常量名/注释写清楚
2. 数据仍按`createdAt` 倒序（当前逻辑正确，保留）
3. 仍只取「果农今天发布」的（`todayKey` 过滤逻辑保留）
4. `pages/index` 抽屉那段的副标题 `drawer.news.sub` 现在的文案是「果农今天还没有发布」/「果农今天还没有发布」这类占位，请改成能反映真实条数的文案（比如「今天有 3 条」/「今天还没有发布」），文案走 `i18n.js`

**注意**：设计稿对今日快讯页的验收清单见 §8，**不要加物候块、不要加知识块、页头不要加"秋分·第15天"那一行**。

---

## 7. 【任务 4】果农工作台：表单加日期字段

**用户原话**：「果农工作台要加日期」。

现状 `miniprogram/pages/seller/publish/publish.wxml` 的表单字段只有：
名称 / 地区 / 具体地点 / 节气·水果 / 体验 / 介绍 / 交通 / 联系方式 / 农人自述 / AI 润色
**没有任何日期字段。** `news.js` 现在是拿 `createdAt` 当"今天"的判据。

要做：
1. 表单加一个日期选择器（`<picker mode="date">`），字段名建议 `activityDate`
2. 提交时一并传给后端（`farmtown.createTown` / `updateTown` 的 payload 加这个键）
3. 今日快讯页的名片卡上显示这个日期（设计稿第 282 行的名片 chip 里已有 `秋分 · 石榴` 这类标签，日期可作为独立一行）
4. 果农没填的日期**不要显示**（设计稿明确：果农没填的行不显示，不出现"暂无"）

**注意**：这个字段要往 `server/farmtown.js` 传。**但铁律第 1 条写着 `server/` 不许动**——
所以你只改前端 payload 结构，**并在汇报里明确告诉我"后端需要加这个字段，代码在 server/farmtown.js，我按约定没动"**，
由我决定什么时候开后端。

---

## 8. 三页验收清单（来自设计稿，逐条回"是/否"）

### 发现页
- [ ] 三张轮播图已按用户要求删除，改为**单张固定海报**（这一条与设计稿原文不同，是用户 2026-10-07 的新决定，优先级高于设计稿）
- [ ] 海报满屏、四周无黑边白边
- [ ] 收起时底部只有一根把手（约 58px 高），没有别的方块
- [ ] 上滑能展开抽屉，下滑能收回；页面其它地方竖滑不受影响
- [ ] 抽屉四段顺序 = 四时 / 游戏 / 行程 / 快讯
- [ ] 四段的标签、标题、副标题字号颜色完全一致
- [ ] 四时 › 进水果文化页（六维）
- [ ] 游戏三行 › 分别直接开局；有未完成的一局时能续玩
- [ ] 行程 › 切到行程页；**快讯 › 进今日快讯页**（任务 2）
- [ ] 游戏次数用完时，三行显示已完成状态，不报错

### 今日快讯页
- [ ] 整页只有果农发布的内容（没有物候块、没有知识块）
- [ ] 页头没有"秋分·第15天｜距霜降8天"这一行
- [ ] 名片卡上没有"导航"按钮
- [ ] 名片字段与果农表单一一对应（名称/节气·水果/体验/地区/距离/介绍/交通/联系方式）
- [ ] 果农没填的行不显示（不出现"暂无"）
- [ ] 空态只有一句话 + 同步说明，没有插画、没有按钮

### 行程页（票夹）
- [ ] 一屏内能看到：下一张票 / 待用的票 / ＋排一张票 / 存根
- [ ] 三个板块的地点互不重复；候选池已排除已排、已去过的园子
- [ ] 「看全部园子 ›」可点
- [ ] 点「＋排一张票」是抽屉，背后仍是票夹页原样（不是空白页）
- [ ] 抽屉只问三件事：去哪（单选）/ 什么时候 / 怎么去
- [ ] 点一张票是在原页展开，没有跳新页面
- [ ] 票上只有 4 项：目的地 / 距出发 / 日期时间 / 交通工具
- [ ] 票上只有「导航出发」和「去过了·撕票盖章」两个动作
- [ ] 盖章后票进入存根，带日期章

---

## 9. 已知的老问题（**不要试图修**，不是你的范围）

全量测试里有 **4 个失败**，是行程页的老问题，跟本次任务无关：

```
#149 route language changes restore summary units and localize the saved trip without rewriting it
#268 route excludes points, clears an infeasible route, and restores all points
#269 route uses its saved profile snapshot and keeps unknown total costs null
#467 route experience entry opens related classroom without requesting GPS
```

**基线就是 485 过 / 4 失败**。你做完之后应该还是 485 过（或更多，因为我会给你加新测试）/ 4 失败。
如果失败数变成 5 或更多，说明你改坏了。

---

## 10. 不要动的文件

```
server/                ← 整个目录，铁律第 1 条
evaluation/
docs/
cloudrun-deploy-v*/    ← 云托管部署包，跟前端无关
_deploy 相关目录
mockups/               ← 设计稿原件，只读
```

`project.config.json` 最近被微信开发者工具重新格式化成多行 JSON，**内容等价、可以保留**，
但**不要再去手工改它的 packOptions.ignore**（主包体积已经达标，见§11）。

---

## 11. 包体积（硬线 2048KB）

```
主包1554KB / 2048KB   余量 494KB
分包 packageWorld 1475KB | packageFruit 720KB | packageMore 259KB | packageTrip 32KB
```

任务 1 换图后**主包不许超过 2048KB**。换完跑一次 `node scripts/measure-package.js` 确认。
如果超了，说明新图被误放进主包了——大图必须只存在于云存储。

主包里体积最大的三个文件（都是数据表，动之前先想清楚）：
```
167.8KB  data/world-fruit-culture.js
109.0KB  data/craft-lessons-doc.js
100.3KB  lib/i18n.js
```

---

## 12. 汇报要求（做完必须回我这些）

1. **编译是否通过**，模拟器截图
2. **改了哪几个文件**（逐个列出，附改了什么）
3. **有没有动清单外的文件**（有就老实说）
4. **§8 的验收清单逐条回"是/否"**，凡是"否"当场说明为什么
5. **上传云存储后拿到的 fileID 原文**（我要填回 `cloud-images.js`）
6. **主包体积的新数值**
7. **测试结果**（`node --test tests/*.test.js`的 pass/fail 数）
8. **人工操作指引**：云存储怎么上传、控制台 fileID 在哪看——我需要转给用户手动操作的部分，
   请单独列出来，不要和你的执行步骤混在一起

---

## 13. 用户协作偏好（必须遵守）

- **先方案、后动手**：动手前先列文件清单，等用户说"可以"再改。**不要先斩后奏。**
- 用户**不是开发者**，技术刚到数据结构。所有需要她在开发者工具/云控制台手动操作的步骤，
  要写成"进哪个网站 → 点哪个按钮 → 填什么"的逐步说明，并给出**完整可复制的绝对路径**。
- 用户**资金敏感**，优先省积分：能用本地校验解决的，不要烧真实 API 调用。
- 交付物**不许擅自存进她的个人目录**（Obsidian Vault / 桌面 / 文档 / 下载）。
- **绝对不许未经同意删除设计稿**（`mockups/`）。发现页下方那块空白区是用户自己要设计的，
  **任何方案都不要往里填**。

---

*任务书结束。有任何与本文冲突的地方，以设计稿 `mockups/final-design-3pages.html` 为准，
但 §8 里标了"与设计稿原文不同"的那一条以本文为准（那是用户 2026-10-07 的新决定）。*