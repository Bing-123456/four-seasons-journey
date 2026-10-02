# 微信小程序实施约定

本轮实施原生微信小程序，CommonJS JavaScript + WXML + WXSS，无前端运行时依赖。保留规划文件。应用名瓜游记，森林绿 #234B3C、奶油底 #F7F5ED、朱红 #D56652、正文 #25392F、次级 #798479。原生自定义 tabBar。

## 文件所有权

- 主代理：project.config.json、package.json、miniprogram/app.*、miniprogram/custom-tab-bar、miniprogram/pages/index、miniprogram/pages/calendar、miniprogram/pages/mine、assets、scripts、README、集成及真机工具测试。
- core agent：miniprogram/data/catalog.js、miniprogram/lib/core.js、miniprogram/lib/store.js、tests/core.test.js。
- pages agent：miniprogram/pages/profile、route、culture，以及 miniprogram/lib/service.js（调用模型与本地回退）。
- server agent：server/、tests/server.test.js、.env.example。

所有代理共享目录，不覆盖他人文件。root 负责 package.json，不另行创建。

## 页面与路由

pages/index/index（发现，tab）、pages/calendar/calendar（四时，tab）、pages/route/route（行程，tab）、pages/mine/mine（我的，tab）、pages/profile/profile、pages/culture/culture?id=PLACE_ID。

## 数据约定

catalog 导出 {seasons, sources, facts, places, interests, defaultProfile}。
season: {id:'summer'|'autumn',name,title,crop,description,monthLabel,accent}。
source: {id,title,publisher,url,publishedAt,checkedAt}。
fact: {id,title,text,sourceIds,season,topic,tags}；事实内容只使用规划中已核实来源，不增加未证史实。
place: {id,name,season,kind:'culture'|'experience',description,duration,price,tags,factIds,cover:'watermelon'|'kiwi'|'craft'|'village',demo:true,openMinutes:540,closeMinutes:1080,capacity}。地点可明确是演示站点，必须与文化事实区分；金额与交通为模拟值。
interests: [{id:'culture'|'family'|'nature'|'photo'|'food'|'slow',label}]。
defaultProfile: {season:'summer',date:'2026-07-18',startTime:'09:00',duration:240,budget:160,transport:'drive',interests:['culture','nature'],partySize:2,note:'',walking:'easy',optInSupport:false}。budget 为团队总预算；price 为单人体验费。

## core API (同步，无 wx 依赖)

- parseProfile(text,base?) -> {profile,missingFields,mode:'local-rules'}。
- generateRoute(profile,options?:{excludedIds}) -> {ok,id,reason,warnings,totalMinutes,totalCost,travelMinutes,visitMinutes,startTime,endTime,season,mode:'simulation',stops:[{placeId,name,arrival,departure,duration,travelMinutes,cost,reason,factId,tags,cover}]}。总时长含返程，费用包含人数。无解 ok:false 不抛异常。
- validateRoute(route,profile) -> {valid,errors}。
- answerQuestion(question,placeId?) -> {answer,sourceIds,evidenceIds,mode:'local-retrieval',unanswerable:boolean}。引用不足拒答，不能乱拼答案。

## store API (wx 同步存储 + Node 内存回退)

- getProfile(), saveProfile(profile), getRoute(), saveRoute(route)
- getFavorites() -> placeId[], toggleFavorite(placeId) -> placeId[]
- getIntents() -> [{id,placeId,placeName,partySize,createdAt,status:'demo',demo:true}], addIntent({placeId,placeName,partySize}), cancelIntent(id)
- getSettings() -> {apiBase:'http://127.0.0.1:8787',useAI:true}, saveSettings(patch)
- clearAll()
- logEvent(type,details), getEvents()

## service API (Promise)

- parseProfile(text,base) -> 同 core，但真实AI mode:'openai-compatible'，仅在验证成功时。
- answerQuestion(question,placeId) -> 同 core，真实AI同上，保留证据。

service 读取 store.getSettings()，useAI 时 wx.request 到 server /api/profile、/api/ask，超时明确回退 core，并标记 fallbackReason。core 路线永远本地确定性计算，不依赖AI。

## server

Node内置http，默认127.0.0.1:8787（通过HOST配置）。GET /health。
POST /api/profile {text,base} -> parse结果。
POST /api/ask {question,placeId} -> answer结果。
POST /api/speech {text,dialect} -> 朗读音频（DashScope TTS，7 种方言，服务端缓存）。
POST /api/asr {audio,format,language} -> 识别文字（DashScope qwen3-asr-flash）。录音不落盘。
语音输入是**双引擎**：优先用微信同声传译插件（`requirePlugin('WechatSI')`，流式、免费，
需后台授权 + `app.json` 的 `plugins.WechatSI` 声明），插件不可用时自动降级为
「小程序原生录音 → 上传 base64 → 服务端识别」。`voice.engine` 暴露实际走的哪条，降级可观测。
⚠️ 插件回调必须**赋值式**注册（`manager.onStop = fn`），调用式是静默空转——与
`wx.getRecorderManager()` 的注册器式不同，别互相套用。
`scripts/check-project.js` 双向拦截插件声明失配（支持 `requirePlugin(常量)` 的间接引用），
并校验客户端调用的 `/api/*` 在 `server/app.js` 有对应路由。
真实模型只使用用户选择的 DeepSeek 官方 API，https://api.deepseek.com，deepseek-flash，key只保存在服务端.env。不调用本机模型。无真实调用时mode必须是本地模式。限制体积、输入、超时；引用ID验证与证据不足拒答；测试注入provider。

## 页面约定

全局 app.wxss 提供 .page,.eyebrow,.page-title,.muted,.card,.button,.button-secondary,.pill,.section-title,.demo-note,.row,.field-label,.empty,.serif,.tab-page。页面主体底部预留180rpx避开tab。
各tab onShow调用 this.getTabBar()?.setData({selected:INDEX})（尽量用普通语法兼容）。
全程清楚标注“公开文化资料 · 行程/库存为情景演示”；文化事实正文不混入虚构传承人与年代。拒绝定位也能完成全部流程。
