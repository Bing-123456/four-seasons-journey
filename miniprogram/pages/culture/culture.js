const speechReader = require('../../lib/speech-reader');
const catalog = require('../../data/catalog');
const store = require('../../lib/store');
const service = require('../../lib/service');
const learning = require('../../data/learning');
const content = require('../content-view');
const i18n = require('../../lib/i18n');

// 果灵朗读：优先使用微信同声传译插件（需在小程序后台添加该插件）。
// 插件未就绪时给出明确提示，不影响页面其他功能。


// 快问快答：问题与答案一一对应，保证点哪条答哪条。
const QUICK_QUESTIONS_EN = {
  '瓜豆酱的主要原料是什么？': 'What are the main ingredients of the melon-bean sauce?',
  '瓜豆酱有哪些家常吃法？': 'How is the melon-bean sauce eaten at home?',
  '石磨盘及磨棒出土于哪里？': 'Where were the stone slab and roller unearthed?',
  '裴李岗磨棒怎样使用？': 'How was the Peiligang roller used?',
  '大河村有哪些文化时期的遗存？': 'Which cultural periods does Dahecun cover?',
  '大河村新馆什么时候开放的？': 'When did the new Dahecun museum open?',
  '西瓜栽培技艺是哪个级别的非遗？': 'What heritage level does the watermelon-growing craft hold?',
  '吃瓜大会是什么时候的活动？': 'When does the melon fair take place?',
  '姚家镇草莓种植历史从什么时候开始？': 'When did strawberry growing start in Yaojia?',
  '草莓有哪些品种？': 'Which strawberry varieties are grown there?',
  '灵宝苹果如何贮藏？': 'How are Lingbao apples stored?',
  '冬天能在这里采摘苹果吗？': 'Can apples be picked here in winter?',
  '猕猴桃有哪些果心颜色？': 'What kiwifruit flesh colours exist?',
  '采摘时间是公历还是农历？': 'Are picking times given in the solar or lunar calendar?'
};
const QUICK_ANSWERS_EN = {
  '瓜豆酱的主要原料是什么？': 'The main ingredients are watermelon and soybean: the watermelon pulp is pressed for juice, the soybeans are boiled, coated in flour and cultured, then combined and sun-fermented in an earthenware jar.',
  '瓜豆酱有哪些家常吃法？': 'At home it is tucked into flatbread, tossed with noodles or dipped with mo; a spoonful lifts a stir-fry, or it is served straight as a pickle with porridge.',
  '石磨盘及磨棒出土于哪里？': 'The stone grinding slab and roller were unearthed at the Peiligang site in Xinzheng — grain-processing tools some eight thousand years old.',
  '裴李岗磨棒怎样使用？': 'Grain was placed on the slab and the roller pushed back and forth by hand to hull and crack it. You can try it in the 3D lesson.',
  '大河村有哪些文化时期的遗存？': 'Dahecun spans Yangshao and Longshan cultures through the Xia-Shang period, with the painted double-connecting-pot among its signature finds.',
  '大河村新馆什么时候开放的？': 'The new Dahecun Site Museum opened in June 2020.',
  '西瓜栽培技艺是哪个级别的非遗？': 'The Zhongmu watermelon-growing craft is on the municipal intangible cultural heritage representative list.',
  '吃瓜大会是什么时候的活动？': 'The melon fair is a summer event when local watermelons ripen; historical reports place it between June and July.',
  '姚家镇草莓种植历史从什么时候开始？': 'Yaojia town government reports trace local strawberry growing to 1990, from scattered plots to scaled operations.',
  '草莓有哪些品种？': 'Common local varieties include Ningyu and Xuelixiang; a December 2024 report records national gold and silver awards for the two at the strawberry congress.',
  '灵宝苹果如何贮藏？': 'Lingbao apples are mainly cold-stored; a November 2025 report documents sorting, packing and shipping — post-harvest storage is a key local industry.',
  '冬天能在这里采摘苹果吗？': 'Picking in the reports happens in autumn; winter is for cold storage and shipping. Confirm opening with the orchard before travelling.',
  '猕猴桃有哪些果心颜色？': 'Kiwifruit come as green, yellow and red fleshed types.',
  '采摘时间是公历还是农历？': 'Picking times in the materials are solar-calendar dates; lunar dates appear only in historical report wording.'
};
const QUICK_ANSWERS = {
  '瓜豆酱的主要原料是什么？': '瓜豆酱的主要原料是西瓜和黄豆。西瓜取瓤出汁，黄豆煮熟裹面捂曲，再拌在一起装瓦盆日晒发酵。',
  '瓜豆酱有哪些家常吃法？': '瓜豆酱家常夹馍、拌面、蘸馍都合适，炒菜时舀一勺提酱香，也可以直接当酱菜就着稀饭吃。',
  '石磨盘及磨棒出土于哪里？': '石磨盘及磨棒出土于新郑裴李岗遗址，是距今约八千年的谷物加工工具。',
  '裴李岗磨棒怎样使用？': '裴李岗磨棒使用时把谷物放在石磨盘上，双手握住磨棒前后推拉碾压，去壳碎粒。可在3D课堂上动手体验。',
  '大河村有哪些文化时期的遗存？': '大河村遗址包含仰韶文化、龙山文化到夏商时期的遗存，出土了彩陶双连壶等代表器物。',
  '大河村新馆什么时候开放的？': '大河村遗址博物馆新馆于2020年6月正式对外开放。',
  '西瓜栽培技艺是哪个级别的非遗？': '中牟西瓜栽培技艺入选了市级非物质文化遗产代表性项目名录。',
  '吃瓜大会是什么时候的活动？': '吃瓜大会是当地夏季西瓜成熟时举办的活动，历史报道多集中在6月至7月。',
  '姚家镇草莓种植历史从什么时候开始？': '姚家镇政府的报道把当地草莓种植历史追溯到1990年，从零散种植逐步走向规模化经营。',
  '草莓有哪些品种？': '姚家镇常见栽培品种有宁玉、雪里香等。2024年12月报道记载，当地选送的“宁玉”与“雪里香”分别获得全国草莓大会评选的金奖与银奖。',
  '灵宝苹果如何贮藏？': '灵宝苹果以冷库贮藏为主，2025年11月的报道记录了当地冷库内分拣、打包与发运的场景，采后贮藏是果乡的重要产业环节。',
  '冬天能在这里采摘苹果吗？': '历史报道中的采摘安排集中在秋季；冬季以冷库贮藏和发运为主，出行前请向果园官方核实开放情况。',
  '猕猴桃有哪些果心颜色？': '猕猴桃按果心颜色分为绿心、黄心和红心三类。',
  '采摘时间是公历还是农历？': '资料中的采摘时间均为公历，农历只在历史报道原文里出现，阅读时以公历为准。'
};

// 方言列表：微信语音能力以普通话/粤语/英语朗读，方言由普通话近似。
function dialectList() { return speechReader.dialects(); }

Page({
  data: { place: null, lesson: null, facts: [], favorite: false, question: '', asking: false, answer: null, error: '', quickQuestions: [], companion: null, dialects: dialectList(), dialect: 'mandarin', reading: false, readBusy: false, L: {} },
  onLoad: function (options) { i18n.applyNav('nav_culture');
    const id = options && options.id;
    const place = catalog.places.find(function (item) { return item.id === id; });
    if (!place) { this.setData({ error: '这篇手记不存在，回到发现页选择其他体验。' }); return; }
    const facts = catalog.facts.filter(function (fact) { return place.factIds.indexOf(fact.id) !== -1 && fact.displayInAlmanac !== false; });
    const en = i18n.getLang() === 'en';
    const quickPairs = place.id === 'summer-kitchen' ? ['瓜豆酱的主要原料是什么？', '瓜豆酱有哪些家常吃法？']
      : place.id === 'summer-culture' ? ['石磨盘及磨棒出土于哪里？', '裴李岗磨棒怎样使用？']
      : place.id === 'dahecun-museum' ? ['大河村有哪些文化时期的遗存？', '大河村新馆什么时候开放的？']
      : place.season === 'summer' ? ['西瓜栽培技艺是哪个级别的非遗？', '吃瓜大会是什么时候的活动？']
      : place.season === 'spring' ? ['姚家镇草莓种植历史从什么时候开始？', '草莓有哪些品种？']
      : place.season === 'winter' ? ['灵宝苹果如何贮藏？', '冬天能在这里采摘苹果吗？']
      : ['猕猴桃有哪些果心颜色？', '采摘时间是公历还是农历？'];
    this.setData({
      place: Object.assign({}, content.placeView(place), { name: i18n.getLang() === 'en' && place.enName ? place.enName : place.name }),
      lesson: learning.forPlace(place.id),
      facts,
      quickQuestions: quickPairs.map(function (q) { return { q, enQ: QUICK_QUESTIONS_EN[q] || q, a: QUICK_ANSWERS[q] || '', enA: QUICK_ANSWERS_EN[q] || '' }; }),
      companion: store.getCompanion(),
      L: i18n.labels(['read_aloud','read_aloud_hint','read_play','read_stop','read_title','ask_title','ask_intro','ask_input_ph','ask_action','ask_searching','ask_found','ask_thin','culture_empty_title','culture_back_home','culture_fav_on','culture_fav_off','note_verify_short'])
    });
    this.refreshState();
    try { store.logEvent('culture_open', { placeId: place.id }); } catch (error) {}
  },
  onShow: function () {
    this.setData({ fontClass: typeof getApp === 'function' && getApp() ? getApp().getFontClass() : 'fs-normal' });
 if (this.data.place) this.refreshState(); this.setData({ companion: store.getCompanion() }); },
  onHide: function () { this.stopRead(); },
  onUnload: function () { this._disposed = true; this.stopRead(); },
  refreshState: function () {
    const place = this.data.place;
    this.setData({ favorite: store.getFavorites().indexOf(place.id) !== -1 });
  },
  backHome: function () { wx.switchTab({ url: '/pages/index/index' }); },
  openLesson: function () { if (this.data.lesson) wx.navigateTo({ url: this.data.lesson.url }); },
  toggleFavorite: function () {
    if (!this.data.place) return;
    try { store.toggleFavorite(this.data.place.id); this.refreshState(); wx.showToast({ title: this.data.favorite ? '已收藏手记' : '已取消收藏', icon: 'none' }); }
    catch (error) { this.setData({ error: error.message }); }
  },
  onQuestionInput: function (event) { this.setData({ question: event.detail.value }); },
  useQuestion: function (event) {
    if (this.data.asking) return;
    const index = Number(event.currentTarget.dataset.index);
    const pair = this.data.quickQuestions[index];
    if (!pair) return;
    this.setData({ question: pair.q });
    this.ask();
  },
  ask: function () {
    const page = this;
    const question = this.data.question.trim();
    if (!question) { this.setData({ error: '写一个关于这里文化的问题，再开始提问。' }); return; }
    if (this.data.asking || !this.data.place) return;
    // 快问快答：命中原配问答，直接给出对应回答，保证问答匹配。
    const pair = this.data.quickQuestions.find(function (item) { return item.q === question; });
    if (pair && pair.a) {
      this.setData({ asking: false, error: '', answer: { answer: i18n.getLang() === 'en' && pair.enA ? pair.enA : pair.a, unanswerable: false, sourceIds: [] } });
      return;
    }
    this.setData({ asking: true, error: '', answer: null });
    service.answerQuestion(question, this.data.place.id).then(function (result) {
      if (page._disposed) return;
      page.setData({ answer: result, asking: false });
      try { store.logEvent('culture_question', { placeId: page.data.place.id, mode: result.mode, unanswerable: result.unanswerable }); } catch (error) {}
    }).catch(function () {
      if (!page._disposed) page.setData({ asking: false, error: '暂时无法回答，可以先阅读上方的文化资料。' });
    });
  },
  // ---- 果灵朗读 ----
  chooseDialect: function (event) {
    const active = this.data.reading || this.data.readBusy;
    this.stopRead();
    this.setData({ dialect: event.currentTarget.dataset.code });
    if (active) this.startRead();
  },
  buildScript: function () {
    const place = this.data.place;
    const parts = [place.name + '。' + place.description];
    this.data.facts.forEach(function (fact) { parts.push(fact.title + '。' + fact.text); });
    return parts.join('。');
  },
  toggleRead: function () { if (this.data.reading || this.data.readBusy) this.stopRead(); else this.startRead(); },
  startRead: function () { return speechReader.start(this, this.buildScript()); },
  stopRead: function () { speechReader.stop(this); },
  noop: function () {}
});
