# 后端修复任务：国风绘画 + 果灵识果不可用

> 这是独立于前端 10.3 批次的后端修复任务。请勿改动前端页面/样式（那部分在 `claude-code-prompt-10.3.md`）。

## 现象（用户在真机/模拟器实测）

1. **国风绘画失败**：`pages/playground/playground` 页，关键词→国风插画，点「生成国风插画」后显示 **"生成失败，请重试"**（前端 `paintNote` 收到的 `error.message`）。
2. **果灵识果失败**：同页点「拍照识别水果」后显示 **"服务暂时 unavailable" / "图片服务暂不可用，请稍后重试"**（来自 `miniprogram/lib/media-service.js` 的 catch）。

两个功能在云托管运行日志里**都没有任何 ERROR 输出**，说明后端 `catch` 后未打印错误，前端拿不到真实原因。

## 环境

- 微信云托管环境：`prod-d8gw4a7vm69f14375`，服务：`guayouji-server`（实例 `-031`），部署包在 `server/` 目录，当前线上版本 v31。
- 环境变量：`MODEL_PROVIDER=cloudbase`、`IMAGE_PROVIDER=cloudbase`、`TCB_ENV_ID`、`TCB_ACCESS_KEY`、`DASHSCOPE_API_KEY`（保留给识图/语音走 DashScope）。
- 已知约束（已验证）：CloudBase 成长计划 **禁止 HTTP 网关调 AI**，只能用 SDK 调用；SDK 鉴权用 `init({env, accessKey})` 传 `TCB_ACCESS_KEY` 即可，无需腾讯云 SecretId/SecretKey。

## 已查到的代码事实（请先复核，再动手）

1. 前端链路由 `miniprogram/lib/playground-controller.js`：
   - `generatePaint()` → `media.request('POST', '/api/ink-painting', { keyword })`
   - `identifyFruit()` → `media.readImage()` 上传云存储换临时 URL → `requestIdentify()` → `media.request('POST', '/api/identify-fruit', image)`
2. 后端路由在 `server/app.js`（约 187、204 行）：`/api/ink-painting`（POST/GET 轮询）、`/api/identify-fruit`（POST）。
3. 国风绘画服务 `server/ink-painting.js`：`submit()` 调 `adapter.create(...)`，失败只 `task.status='failed'`，**不打日志**；`status()` 失败也只返回固定文案。
4. `server/index.js`：`IMAGE_PROVIDER=cloudbase` 时走 `createCloudBaseImageAdapters(config.image.cloudbase)`，`text2image` 适配器用于国风绘画。
5. `server/image-provider.js` 的 `createCloudBaseImageAdapters`：
   ```js
   const imageModel = app.ai().createImageModel('hunyuan-image');
   // ...
   imageModel.generateImage({ model: 'HY-Image-3.0-Plus-4090-Tob-v1.0', prompt, size: '1024x1024' });
   ```
   **⚠️ CloudBase 官方 JS SDK 文档（https://docs.cloudbase.net/ai/image-model/js-sdk-usage）明确要求调用前配置子路径映射：**
   ```js
   imageModel.generateImageSubUrlConfig["hunyuan-image"]["HY-Image-3.0-Plus-4090-Tob-v1.0"] = "images/ar/generations";
   ```
   **当前代码缺少这行**，这是国风绘画失败的最可能原因，请优先验证并修复。
6. 识果链路 `server/chat.js` 或相关路由用 DashScope `qwen-vl`（走 `DASHSCOPE_API_KEY`）。失败可能是 key 未传递到 CloudBase 容器环境变量、额度耗尽、或 qwen-vl 接口报错被静默吞掉。

## 要求你（Claude Code）做的

### 第一步：先验证，别盲改
- 通读 `server/image-provider.js`、`server/ink-painting.js`、`server/app.js`、`server/index.js` 中与国风绘画和识果相关的代码。
- 确认 CloudBase 文生图的子路径映射是否真的缺失，以及 SDK 版本（`@cloudbase/node-sdk` 在 `package.json`）是否默认已含该映射（读 node_modules 类型定义或源码确认）。
- 确认识果失败时后端实际抛了什么错（先看 catch 处有没有日志，没有就先加日志再本地起服务复现）。

### 第二步：修复国风绘画
- 在 `createCloudBaseImageAdapters` 里正确初始化 `imageModel`，必要时补上 `generateImageSubUrlConfig` 子路径映射。
- 确保文生图调用参数（`model`、`prompt`、`size`）符合 CloudBase 文档（prompt ≤ 500 字，size 支持 `1024x1024` 等）。
- 验证 `text2image.create()` / `status()` 的返回结构与 `ink-painting.js` 的解析逻辑（`output.task_status` / `image_url` / `results[].url`）一致。

### 第三步：修复果灵识果
- 排查 `/api/identify-fruit` 链路，确认 `DASHSCOPE_API_KEY` 在 CloudBase 容器环境变量中已正确配置并能被进程读取。
- 修复任何导致识别失败的逻辑错误（JSON 解析、超时、模型名等）。

### 第四步：补齐错误日志（重要）
在以下位置加 `console.error`，把真实错误打到云托管运行日志，方便用户后续自查：
- `server/ink-painting.js` 的 `submit()` catch（adapter.create 失败）、`status()` catch（adapter.status 失败）。
- `server/image-provider.js` 的 `createCloudBaseImageAdapters.run()` catch（generateImage 失败）——当前 `catch (_) { job.status='failed'; }` 完全吞掉错误，请改为记录 `error.stack`。
- 识果链路相关 catch 处。

### 第五步：跑测试
- `node --test tests/*.test.js` 必须全绿。
- 如有 e2e 脚本（如 `scripts/e2e-guoling.js`），也跑一遍确认无回归。
- 修改涉及 CloudBase / DashScope 网络调用的，确保有 offline mock 单测覆盖，不依赖真实 key。

### 第六步：打包部署
- 按现有部署流程生成部署包，**版本号递增：v31 → v32**（目录 `cloudrun-deploy-v32/` + 根目录 zip 命名 `guayouji-server-cloudrun-v32.zip`）。
- **严禁复用旧文件名**（v31 之前的名字都不可再用）。
- 部署包需包含 `server/`、`miniprogram/` 数据软链或内嵌（保持现有 `dualPath` 回退机制）、`Dockerfile`、`package.json`。
- 本地冒烟：起服务后手动 curl `/api/ink-painting` 和 `/api/identify-fruit`（用配对 token）确认不再返回 failed。

## 交付后告诉用户
- 改了哪几个文件、改了什么、为什么失败。
- 生成的部署包路径（v32）及上传方式（微信云托管控制台上传 zip）。
- 是否需要用户重新配对（缩容到 0 后冷启动会丢配对会话，需在运行日志看新配对码）。
