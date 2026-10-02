# 瓜游记模型服务

在项目根目录执行 `node server/index.js`，或使用根项目提供的服务启动命令。需要 Node.js 20 或更新版本；服务无额外 npm 依赖。默认监听 `127.0.0.1:8787`。

启动器只读取项目根目录的 `.env`，不会寻找其他目录中的密钥；系统环境变量优先。未配置云端时，画像、问答、活动及卖家分析使用本地规则和资料检索；识图和图片生成明确提示不可用。服务不包含本机模型支持。

## 云端配置

将 `.env.example` 复制为 `.env` 后填写：

```dotenv
MODEL_PROVIDER=openai-compatible
OPENAI_BASE_URL=https://api.deepseek.com
MODEL_NAME=deepseek-flash
OPENAI_API_KEY=你的服务端密钥
MODEL_TIMEOUT_MS=30000
```

没有完整的模型名称、密钥，或设置 `MODEL_PROVIDER=disabled` 时，服务使用离线模式。修改环境文件后需要重启服务。模型名称应以当前账号可用模型为准；不支持的模型、账户错误和网络失败均返回明确的本地回退结果。

密钥只放在服务端，不放入小程序源代码、开发者工具配置、客户端设置或交付压缩包。项目的 `.env` 由主项目忽略规则排除。

识图和图片生成独立于文本模型配置：

```dotenv
DASHSCOPE_API_KEY=你的服务端百炼密钥
IMAGE_PROVIDER=dashscope
VISION_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
VISION_MODEL_NAME=qwen-vl-plus
VISION_TIMEOUT_MS=30000
```

`VISION_API_KEY` 可覆盖识图使用的密钥；未设置时复用 `DASHSCOPE_API_KEY`。识图不会将图片交给纯文本模型。`DASHSCOPE_BASE_URL` 可覆盖图片服务的默认 `https://dashscope.aliyuncs.com`，所有供应商地址均要求 HTTPS。图片编辑使用 `wanx2.1-imageedit` 的指令编辑能力，国风插画使用 `wanx2.1-t2i-turbo` 的异步文生图接口。请确保密钥所属地域和账号实际支持这些模型。

## 接口

| 请求 | JSON 输入 | 输出 |
|---|---|---|
| `GET /health` | 可携带短期会话 | `ok`、`auth`、`model` 状态，不输出密钥、配对码或会话令牌 |
| `POST /api/pair` | `{code}` | 一次性开发配对码换 30 分钟会话；失败返回明确状态 |
| `POST /api/profile` | `{text,base?}` | `profile`、`missingFields`、`mode` |
| `POST /api/ask` | `{question,placeId?}` | `answer`、`sourceIds`、`evidenceIds`、`unanswerable`、`mode` |
| `POST /api/seller-insight` | 已校验的批次、风险、天气、游客信号和文化资料 | 风险解读、建议及未发布方案草案；状态保持程序测算结论 |
| `POST /api/identify-fruit` | `{base64,mimeType}` | `identified`、`fruit?`、`confidence?`、`mode`；不识别时提供手动选择提示 |
| `POST /api/fruit-story` | `{keyword,language?}` | `zh`、`en`、`mode` |
| `POST /api/translate` | `{blocks,target?}` | `items`、`translated`、`mode`；失败返回原文并标记 `translated:false` |
| `POST /api/speech` | `{text,dialect}` | 缓存音频 `audioUrl`、`dialect`、`cached`；7 种方言 |
| `POST /api/asr` | `{audio,format,language?}` | 识别文本 `text`；`language` ∈ `zh`（含川/闽南/吴方言）/`yue`/`en`；base64 音频解码后 ≤ 1.5 MB |
| `POST /api/ink-painting` | `{keyword}` | 异步 `taskId`、`status` |
| `GET /api/ink-painting/:taskId` | 原提交会话 | `queued/generating/succeeded/failed`，成功时含 `imageUrl` |
| `POST /api/companion/uploads` | `{confirmed:true,base64,mimeType}` | 私有临时 `resourceId` |
| `POST /api/companion/generations` | `{resourceId,requestId,style:"fruit-line-art"}` | 幂等异步 `taskId`、`status` |
| `GET /api/companion/generations/:taskId` | 原提交会话 | 图片任务状态，成功时含 `imageUrl` |

POST 使用 `Content-Type: application/json`。同步模型任务包含 `latencyMs`。成功使用云端输出时 `mode` 为 `openai-compatible`；未使用云端输出时保留对应的本地模式，并在发生回退时返回 `fallbackReason`。超时不会被标记为模型成功。图片任务保留 30 分钟；成功结果在进程中缓存，重复查询不会再次请求供应商，服务重启会清除临时任务。

语音链路（朗读 `/api/speech` 与语音输入 `/api/asr`）共用同一个 DashScope key 与原生端点，但独立配置、独立上报可用性。语音输入的录音**不落盘**：收到 base64 音频后直接送模型，响应里只回文字。识别失败分五档（`asr_invalid` 400 / `body_too_large` 413 / `asr_empty` 422 / `asr_unavailable` 502 / `asr_disabled` 503），其中 `asr_empty`（模型正常应答但没听出内容）与 `asr_unavailable`（调用失败）刻意分开——否则「没听清」会被当成「服务故障」。

问答的云端能力是**核验证据选择与排序**：先用本地资料找到候选证据，再让模型选择相关事实，最后由服务从审核过的事实记录组装答案并计算引用。未经验证的模型自由文本不会成为事实答案；资料不足时拒答。活动描述是建议草案，不能作为已发布活动或实际助农成效的证明。

画像解析不会替用户打开 `optInSupport`。路线规划继续由小程序本地确定性算法执行，不由语言模型生成路程、费用或可用名额。

## 开发版接入

开发者工具模拟器连接默认回环地址即可。手机无法使用电脑的 `127.0.0.1`；受信任局域网测试需要显式更改 `HOST` 并使用电脑的局域网地址。对外监听时仍须在服务端配置至少 24 字符的 `API_TOKEN`；它是服务端管理令牌，不填写到小程序。

服务启动后只在电脑终端显示一个 8 位开发配对码。小程序“我的”保存服务地址、检查连接，再输入配对码。配对码有效期 5 分钟、只能成功使用一次；成功后终端生成新码。输入过期码会返回过期提示并在终端生成新码。每个来源每 5 分钟最多尝试 5 次，全服务最多 20 次，最多保留 100 个尚未到期会话。

配对成功后，小程序仅保存随机短期会话，接口请求自动发送 `Authorization: Bearer <session>`；默认 30 分钟过期。过期或服务重启后，需要重新配对。更改后端地址、清除本机数据时移除旧会话。会话令牌不传给 DeepSeek，不展示在页面，不进入事件日志。这个开发配对流程不替代正式用户系统；公网发布仍需 HTTPS、微信登录、按用户鉴权、配额及合法请求域名。HTTP 局域网配对只用于受信任的开发网络。

`/health` 将状态分开：服务是否可达、当前请求是否已认证、文本 `model`、识图 `vision`、伙伴生成 `image` 和插画生成 `inkPainting` 是否配置。文本和识图分别记录最近一次调用的状态；刚启动时已配置通道的 `availability` 为 `not-checked`，不声称模型已经验证可用。`vision.maxImageBytes`、`image.maxImageBytes` 表示图片上限。健康检查本身不调用模型、不会消耗额度。配对不会自动启用云端，云端助手默认关闭，用户阅读发送范围后自行打开。出游条件解析不上传用户选择的起点坐标；收藏和行为日志也不上传。

默认最多 2 个并发上游请求，每个认证会话每分钟最多 30 次提交；本机免配对模式按客户端地址计数。图片轮询单独允许每分钟 120 次，避免耗尽提交额度，反向代理后的不同会话也不会共用额度。文本请求体上限 16 KiB；识图和伙伴上传允许 3 MiB 的 JSON，请求中的图片经 Base64 解码后不得超过 2 MiB，且必须与 JPEG、PNG 或 WebP 声明格式相符。限流返回 429、忙碌返回 503、输入错误返回 400，正文使用 `{error,code}`；模型错误不会把供应商响应或秘密配置原样返回。

## 测试

在根目录执行：

```sh
node --test tests/server.test.js tests/auth-regressions.test.js tests/backend-capabilities.test.js tests/image-provider.test.js tests/image-contract.test.js
```

自动测试使用真实的本地资料和算法、注入的云端 mock，不读取项目 `.env`，不消耗云端额度。覆盖 HTTP 输入、离线模式、画像同意设置、证据验证、活动数字、超时释放、令牌、限流、并发、跨来源请求和配置读取。真实云端调用需另行验收，不能由这些 mock 测试推断为已通过。

配对回归使用真正的客户端 service → 本地 HTTP 服务通信，覆盖未认证 401、一次性配对、过期、猜码节流、跨后端会话隔离和健康状态；没有把 `wx.request` 的成功响应写死。测试不读取或打印真实配置中的密钥。
