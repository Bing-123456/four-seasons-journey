# 果物四时记 · 河南农耕文化小程序

原生微信小程序：以有出处的河南农耕文化为内容基础，提供四时链图、文化阅读、参考行程、证据问答、瓜豆酱图文课堂、裴李岗农具 3D 小课堂、果农经营工作台与世界风物（GIAHS）阅读层。全站支持中英双语（界面词典 + 内容名词 + 长文按需 AI 翻译）。

- 后端：`https://guayouji.orionsheep.com`（内置团队直连凭证，零配对安装即用；文本 AI、识果、照片转伙伴、国风插画、按需翻译均已接真实供应商）
- AppID：`wx168d052d2db78132`（project.config.json 已配置）
- 当前版本：**0.8.16**（详见 [测试版交付-0.7.6](docs/测试版交付-0.7.6.md)）

## 导入与运行

1. 微信开发者工具导入本目录（已配置 `miniprogramRoot: miniprogram/`），AppID 用上者或游客模式。
2. 「编译」即可运行；不连后端也能阅读文化资料、课堂互动、本地规则行程与证据问答。
3. 发测试版：`cli upload --version x.y.z` → 后台「版本管理」设为体验版（详见 [测试版发布教程](docs/测试版发布教程.md)）。

## 三层验证（发版前全部跑绿）

| 层 | 命令 | 覆盖 |
|---|---|---|
| 单元/契约测试 | `npm test` | 288 条：业务逻辑、数据契约、错误路径、翻译契约 |
| 真渲染功能测试 | `cli auto --auto-port 9420` 后 `node scripts/test-real-ui.js` | 13 项中文主流程（3D/WebGL、地图、AI 解析、全链路） |
| 双语言全页巡检 | `node scripts/crawl-pages.js` | 22 页 × 中英 = 44 视图，零错误巡检 |
| 检索质量评测 | `npm run eval:retrieval` | 种子问题检索对照（hit@k / MRR / 拒答召回） |
| 线上服务冒烟 | `API_TOKEN=… node scripts/smoke-service.js https://guayouji.orionsheep.com` | 10 项真实 AI 全链路（问答/翻译/识果/两条生图） |

项目检查：`node scripts/check-project.js`（主包 ≤2MB 预算、页面完整性、密钥扫描）。

## 双语架构（改文案必读）

- **界面层**：`miniprogram/lib/i18n.js` 词典（1100+ 词条）。WXML 一律绑定 `L.xxx`，**不要写中文字面量**；JS 提示语用 `i18n.t('key')`；导航栏标题用 `i18n.applyNav('key')`。
- **名词层**：词典 `fruit_<id>` / `season_name_*` / `farm_crop_*`，数据文件保持纯中文，展示点按语言取词。
- **长文层**：固定短课程（乡味课/世界风物）在数据文件手写 `en*` 字段；开放长文（文化页/3D 课/手艺课/搜索回答）用「EN 按钮 + `service.translate`」按需 AI 翻译，**不做本机假翻译**。
- 关键披露文案（演示账户声明、世界层范围边界）已与词典绑定断言，漏改会被 `ui-regressions` / `world-pack` 测试拦住。

## 代码结构

- `miniprogram/lib/` — 状态（store）、业务规则（core/seller-core/farm/workshop）、服务（service/weather/visitor-flow）、i18n
- `miniprogram/data/` — 有源内容（catalog/fruit-culture/farm-proverbs/solar-term-notes/farmer-stories…）
- `miniprogram/packageWorld/` — 世界风物分包（自洽，仅允许引用主包 `lib/i18n`）
- `server/` — VPS 后端（openai-compatible；/api/profile、/api/ask、/api/translate、/api/identify-fruit、/api/place-recommend、/api/seller-insight 等）
- `tests/` — 288 条单测；`scripts/` — 巡检/真渲染测试/打包/部署

## 重要边界

真实地点与有源文化资料不等于当前可预约服务；无商户、订单、支付或即时库存。演示账户数据全模拟且与个人账户隔离；文化长文的英文为 AI 翻译并保留原文可切换。

## 文档索引

- [测试版发布教程](docs/测试版发布教程.md)（长期有效的体验版）
- [测试版交付-0.7.6](docs/测试版交付-0.7.6.md)（当前版本交付与验证记录）
- [测试版交付-0.6.0](docs/测试版交付-0.6.0.md)（双语工程全过程：0.5.7→0.7.0 逐版本记录）
- [VPS 部署](docs/VPS部署.md)、[图片生成接口契约](docs/图片生成接口契约.md)、[卖家原型说明](docs/卖家原型说明.md)
