# HANDOFF.md — 果物四时记 / 瓜游记 小程序

> 交接给 Claude Code 用。本文档自包含，尽量把"踩过的坑"一次性写清，避免重新踩。
> 最后更新：2026-10-03 17:00

---

## 0. 一句话状态（已验证）

- **后端 v31 已成功部署**到微信云托管，线上服务 `guayouji-server-021`（2026-10-03 16:46 发布，状态"服务正常"），1 个实例运行。
- **前端重构（行程 / 果农工作台）代码已写完、单测全绿**，体验版包已生成，待用户在微信开发者工具上传体验版。
- 用户（大学生，资金敏感，诉求：一次改成功、省积分、先问后做、不要自行发挥）将用体验版实测，Claude Code 接手剩余前端功能与可能的修复。

---

## 1. 项目背景

| 项 | 值 |
|---|---|
| 项目名 | four-seasons-journey（果物四时记 / 瓜游记），微信小程序 |
| AppID | `wx168d052d2db78132` |
| 原开发者 | 已离职 |
| 本地代码副本 | `four-seasons-journey-main/`（即本目录，也是微信开发者工具工程根） |
| GitHub 私有仓库 | `Bing-123456/four-seasons-journey`（用户本人账号，0.8.16 全量已推送） |
| 需求文档 | 飞书（飞书连接器已授权；绿色高光 = 待做需求） |
| 用户权限 | 微信公众平台管理员/开发者，可上传体验版 |

工程根即 DevTools 工程目录：`project.config.json` 的 `miniprogramRoot=miniprogram/`，`appid=wx168d052d2db78132`。

---

## 2. 当前部署状态

### 2.1 后端（微信云托管）
- 环境：`prod-d8gw4a7vm69f14375`
- 服务：`guayouji-server`（**自定义创建**，不要用 Express/Koa 模板——模板会强制覆盖启动命令并连它自己的 MySQL，导致容器永远起不来）
- 当前线上版本：`guayouji-server-021`（运行正常）
- 公网域名：`https://guayouji-server-322229-5-1499093335.sh.run.tcloudbase.com`
- 小程序通过 `wx.cloud.callContainer` **内网**访问，**无需在公众平台配置服务器域名**

### 2.2 前端（小程序）
- 体验版包：`guayouji-miniprogram-deploy-20261003.zip`（2.9MB，273 条目，在工程根目录）
- 工程根 `four-seasons-journey-main/` 即 DevTools 工程，直接导入即可
- **注意**：果乡列表/详情/发布（`/api/farmtown*`）需后端在线才有数据；UI/布局可离线预览

---

## 3. ⚠️ 铁律 / 踩坑清单（最重要，务必先读）

这些是花真金白银/真时间换来的，**不要重新发现**：

1. **成长计划禁止 HTTP 网关调 AI**（错误码 `AI_CHANNEL_NOT_ALLOWED`）。CloudBase AI（环境 `cloud1-d5gcgaukz8cb3f907`，≠云托管环境）的 AI 调用**必须走 `@cloudbase/node-sdk` 的 `init({env, accessKey})`**，不能 curl 公网 `/v1/ai/cloudbase`。API Key 的 HTTP 直调只有少量试用额度，一次 e2e 26 题就烧光且通道会被关。

2. **hy3 是思考型模型**，调用时必须带 `thinking:{"type":"disabled"}`，否则 token 全烧在 `reasoning_content`、`content` 为空。

3. **不要创建/使用腾讯云 CAM 密钥**（SecretId/SecretKey）。实测无 tcb 权限（`EXCEED_AUTHORITY` / 403）。正确做法是 SDK `init` 直接传 `accessKey: <CloudBase API Key JWT>`（控制台"AI+"页面那个 JWT，几乎永久有效）。

4. **chat.js 的 `callModelOnce` 是独立 HTTP 调用，不走 `provider.js` 的 transport**。切任何模型通道时，`provider.js`（导出 `createCloudbaseModel` 工厂）和 `chat.js` 的 `callModelOnce` **两处都要改**，否则 `/api/chat` 还是走老通道。

5. **`server/app.js` 顶部引入的是 `const nodePath = require('node:path')`**，所有 `path.join/...` 必须写成 `nodePath.join/...`。**v29/v30 部署失败（镜像创建即崩 `ReferenceError: path is not defined`）就是这个 bug**（原误判为 lockfile/镜像源问题，浪费一轮）。v31 已修。

6. **部署包命名规则（用户硬要求）**：重新生成部署包**必须递增版本号，绝不复用旧文件名**（v29→v30→v31…）。之前四次复用 `v20` 名字被用户质疑过。

7. **后端 `server/` 会经 `require('../miniprogram/...')` 回退加载 `miniprogram/data` 和 `miniprogram/lib`**。所以云部署 zip **必须包含 `miniprogram/` 目录**（否则运行期缺数据/库）。

8. **`config.js` 读 `process.env`，不需要 `.env` 文件**；`HOST` 默认 `127.0.0.1`，Dockerfile 必须写死 `ENV HOST=0.0.0.0`；非本机监听时 `API_TOKEN` **必须 ≥24 位**。

9. **缩容到 0 后冷启动**：配对会话丢失，需在云托管"运行日志"看新 8 位配对码重新配对（仅本地调试/自定义后端时需要，见 §6）。

10. **回归工作流（用户强烈要求，省积分）**：改服务端 → 先 `npm test` → 再 `node scripts/e2e-guoling.js <本地起服务地址>`（26 题开放题集）→ 全绿才让用户部署；改客户端 → 单测 + 一轮预览抽查；**禁止改一点传一次**。

11. **项目约定：字体缩放用 CSS 变量** `calc(Nrpx * var(--fs-scale,1))`，不要写裸 `font-size: Nrpx`（会被 `tests/font-scale.test.js` 卡住）。`app.wxss` 提供 `.fs-normal/.fs-large/.fs-xlarge` 三档。

12. **新增页面必须在 wxml 加全局 `<demo-notice id="demo-mode-notice"/>`**，否则 `tests/ui-regressions.test.js`（"all pages identify isolated demo account"）会失败；`demo-notice` 已在 `app.json` 全局注册。

---

## 4. 架构概览

- **小程序端**：`miniprogram/`。入口 `app.js`（`app.json` 含 `cloud:true` + `wx.cloud.init`）。核心 lib：`miniprogram/lib/store.js`（后端连接/令牌/配对）、`media-service.js`/`service.js`（走 `wx.cloud.callContainer`）、`search.js`（果灵问答客户端，42 果别名归一 + 语音错字纠错 + 当季时令包 + 本地闲聊兜底）。
- **后端**：`server/`（Node，Express）。入口 `server/index.js`，启动文件 `server/app.js`。关键模块：`chat.js`（果灵问答 SYSTEM 铁律 + 答点守卫 + 情况B兜底）、`provider.js`（模型通道工厂，含 cloudbase SDK 分支）、`image-provider.js`（混元文生图/图生图）、`config.js`（读环境变量）、`auth.js`（令牌校验）、`farmtown.js` + `/api/farmtown-polish`（行程重构新增）、`place-recommend.js`（G22 三种玩法）。
- **云部署**：`cloudrun-deploy-vN/` 目录 + 根目录 zip。Dockerfile：`node:18-alpine` + 腾讯云 npm 镜像 `https://mirrors.cloud.tencent.com/npm/` + 不带 `package-lock.json` + `ENV HOST=0.0.0.0 PORT=80` + `CMD node server/index.js`。
- **前端重构页面（本轮新增/重写）**：`route`（四时果乡漫游，替代旧"文化地点规划"）、`fruit-town`（果乡详情）、`season-journal`（手账）、`seller/index`（发布站重写）、`seller/publish`（发布表单），均在 `app.json` 注册，`mine` 页面加入口。

---

## 5. 环境变量（云托管，服务设置 → JSON 模式粘贴）

> 以下均已配在 `guayouji-server-021`，**不要随意改**。secret 类（TCB_ACCESS_KEY / DASHSCOPE_API_KEY）值见云托管控制台，本文不重复。

```json
{
  "API_TOKEN": "99fb6493972c19271035cc64ce98d039e4cf55ab0bd1ac86b2004ef8ad5e5539",
  "MODEL_PROVIDER": "cloudbase",
  "MODEL_NAME": "hy3",
  "TCB_ENV_ID": "cloud1-d5gcgaukz8cb3f907",
  "TCB_ACCESS_KEY": "<CloudBase AI+ 页面 JWT，已在控制台>",
  "IMAGE_PROVIDER": "cloudbase",
  "DASHSCOPE_API_KEY": "<阿里云百炼，识图/语音用，已在控制台>",
  "HOST": "0.0.0.0",
  "PORT": "80"
}
```

- `API_TOKEN` **必须**等于前端 `miniprogram/lib/store.js` 的 `DEFAULT_BACKEND.token`（即上面这个值），否则主令牌自动鉴权不通过。
- `OPENAI_BASE_URL` / `OPENAI_API_KEY` **不再需要**（已切 CloudBase，删除无妨）。
- `TCB_ACCESS_KEY` 是 CloudBase API Key（JWT），**不是**腾讯云 CAM 密钥。

---

## 6. 鉴权 / 配对机制（重要澄清，用户曾被误导）

- 前端 `store.js` 的 `DEFAULT_BACKEND` 已**硬编码主令牌** `99fb6493…5539`，与云托管 `API_TOKEN` 一致。
- 对含 `tcloudbase.com` 的 `apiBase`，`media-service.js`/`service.js` 走 `wx.cloud.callContainer`（`X-WX-SERVICE=guayouji-server`，`env=prod-d8gw4a7vm69f14375`），并**自动带该 Bearer 令牌**。
- 后端 `auth.js` 校验：令牌与 `config.token` 一致 → 直接 `authenticated:true`（administrative 模式），**无需 8 位配对码**。
- **结论：默认云托管部署下，直接打开体验版小程序即可用，网页后台没有也不需要有"开发配对"入口**。云端日志里的 8 位配对码**仅用于本地开发 / 自定义后端地址**。
- 若真机/体验版实际报 401 或"请配对"，再考虑在"我的"页补手动配对 UI（截至目前未做，等用户实测反馈）。

---

## 7. 本会话（2026-10-03）完成的工作

1. 生成《果物四时记-项目全貌.txt》（1.17MB，15887 行，给 DeepSeek 看全项目用；无明文密钥）。
2. **前端体验版包**：`guayouji-miniprogram-deploy-20261003.zip`（2.9MB，273 条目，顶层含 `project.config.json`+`project.private.config.json`+`miniprogram/`）。
3. **CloudBase AI 迁移收尾**：文字(hy3) + 生图(混元 HY-Image-3.0-Plus / HY-Image-v3.0-I2I-ToB 垫图) 走 `@cloudbase/node-sdk`；识图/语音保留 DashScope。476 单测 + e2e 26 题全绿。
4. **后端部署包**：v29（初版）→ v30（去 lockfile + 腾讯镜像）→ **v31（修 `server/app.js:70` 的 `path`→`nodePath`）**。v31 用户上传后发布成功（`guayouji-server-021`）。
5. 前端重构（行程/果农工作台）：新页面代码 + 测试；修了 font-scale 回归（5 个新 wxss 用 `calc(...var(--fs-scale,1))`）、demo-notice 回归（5 页补 `<demo-notice>`）；删除 2 条陈旧 `ui-regressions` 测试（测已删除的旧"文化地点规划"功能）。route-page(7)+seller-page(5)+font-scale(5)+ui-regressions(12) 全绿。
6. **G22 三种玩法**：修复离线兜底（原来三种玩法返回同一批农场只换句尾），现按所选玩法筛选适配地点 + 优雅回退；线上其实早已通过 `experience` 字段区分。
7. 澄清"开发配对"误区（§6）。

> 注：本会话初判 v29/v30 失败根因为 lockfile/镜像源属**误判**，真实根因是 §3.5 的变量名 bug，v31 才真正解决。勿再走"去 lockfile / 换镜像"的老路。

---

## 8. 待办 / 下一步

- [ ] 用户在微信开发者工具**上传体验版前端包**，真机/体验版实测：果乡列表/详情/发布、果灵问答(hy3)、照片转卡通/国风绘画(混元)。
- [ ] 若实测报 401/配对错误 → 评估在"我的"页加手动配对 UI。
- [ ] 飞书绿色需求剩余项（约 13 项前端改动，0.8.17）：P12 农谚问答、P17 学手艺、P20 三种玩法（已部分处理 G22）、P21 果农故事图片、P24 文化提示等。
- [ ] 主包超 1.5M 警告（不阻断上传），后续可考虑分包。
- [ ] 建议用户删除用不上的腾讯云 CAM 密钥（曾误建并暴露过明文 SecretId `AKIDkcJo8…`）。

---

## 9. 用户偏好与工作红线（AI 协作）

- **先问后做**：动手前先确认方案，不要自行发挥。
- **资金敏感**：省积分优先（用 mock/本地校验代替真调用；e2e 真调用只在验收阶段做一次）。
- **一次改成功**：改一点传一次是被反感的工作方式（见 §3.10 回归流程）。
- **部署包必须递增版本号**（§3.6）。
- **红线**：未经用户明确同意，**绝不**把交付物存入用户个人目录（Obsidian Vault / Desktop / Documents 等）。用户说放才能放。
- 用户：李姝涵（冰冰），河南财经政法大学，软件工程（金融信息化），开学大二，19 岁。技术刚到数据结构，代码主要靠 AI 生成 + 自调。

---

## 10. 关键文件路径

```
four-seasons-journey-main/
├── HANDOFF.md                      ← 本文
├── miniprogram/                    ← 小程序前端（DevTools 工程主体）
│   ├── app.js / app.json / app.wxss
│   ├── lib/store.js                ← 后端连接/令牌/配对（DEFAULT_BACKEND 主令牌在此）
│   ├── lib/media-service.js        ← callContainer 内网调用
│   ├── pages/route/                ← 四时果乡漫游（新）
│   ├── pages/fruit-town/           ← 果乡详情（新）
│   ├── pages/season-journal/       ← 手账（新）
│   ├── pages/seller/               ← 发布站 + 发布表单（重写）
│   └── data/ lib/                  ← 后端 server 会回退加载这里
├── server/                         ← 后端（Node/Express）
│   ├── index.js / app.js           ← app.js:70 是修过的 nodePath.join
│   ├── chat.js / provider.js / image-provider.js / config.js / auth.js
│   ├── farmtown.js                 ← 行程重构新增
│   └── place-recommend.js          ← G22 三种玩法
├── cloudrun-deploy-v31/            ← 当前线上部署包（最新）
│   ├── Dockerfile / build-cloud-zip.py
│   ├── guayouji-server-cloudrun-v31.zip   ← 已部署
│   ├── 环境变量.json / v31 修复说明.txt
├── cloudrun-deploy-v29/ cloudrun-deploy-v30/   ← 历史包（v30 未部署，v31 全含）
├── guayouji-miniprogram-deploy-20261003.zip   ← 前端体验版包
├── tests/                          ← 单测（route-page/seller-page/font-scale/ui-regressions/provider-cloudbase/image-provider-cloudbase…）
├── scripts/                        ← zip-frontend.py / fix-fs-scale.js / add-demo-notice.js / e2e-guoling.js
└── package.json                    ← 0.9.0，含 @cloudbase/node-sdk 3.18.3
```

---

## 11. 测试与验证命令

```bash
# 单测（应在仓库根 four-seasons-journey-main/ 运行，需先 npm install）
npm test
# 预期：route-page(7) + seller-page(5) + font-scale(5) + ui-regressions(12) + provider-cloudbase + image-provider-cloudbase … 全绿
# 注：server.test.js(12) / booking-http(2) 需真实后端/密钥，属 CloudBase 迁移另一条工作流，隔离运行才稳；
#     route-presentation/seller-insight 在全量下会因 server 测试 mock 泄漏而假红，隔离运行全过。

# 后端 e2e 果灵问答（26 题开放题集，验收阶段才跑，烧积分）
node scripts/e2e-guoling.js http://localhost:80

# 本地起后端（验证部署包）
cd cloudrun-deploy-v31 && docker build -t guayouji-test . && docker run -p 80:80 --env-file <env> guayouji-test
# 或本地 node：在 four-seasons-journey-main/ 起 server/index.js，curl /health 应返回正常
```

---

## 12. 若需重新部署后端（给 Claude Code 的快速流程）

1. 改 `server/` 代码后，**必须**先 `npm test` 全绿、再本地起服务跑 `e2e-guoling.js` 全绿。
2. 版本号 +1：新建 `cloudrun-deploy-vXX/`（复制 v31 的 Dockerfile/build-cloud-zip.py）。
3. 运行 `python build-cloud-zip.py` 生成 `guayouji-server-cloudrun-vXX.zip`（自动含 `server/` + `miniprogram/` + `package.json` + `Dockerfile`，不带 lockfile/node_modules）。
4. 微信云托管 → 新建版本 → 上传 zip → 端口 80 → 沿用已保存环境变量 → 发布。
5. 看"运行日志"确认 `/health` 正常、无 `path is not defined` 之类崩溃。

---

*交接完毕。有任何与本文冲突的情况，以云托管控制台实际配置和 `miniprogram/lib/store.js` 的 `DEFAULT_BACKEND` 为准。*
