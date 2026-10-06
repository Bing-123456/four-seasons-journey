const store = require('../../lib/store');
const service = require('../../lib/service');
const catalog = require('../../data/catalog');
const contentView = require('../content-view');
const farmLib = require('../../lib/farm');
const farmProverbs = require('../../data/farm-proverbs');
const companionLib = require('../../lib/companion');
const i18nL = require('../../lib/i18n');
const cloudImg = require('../../lib/cloud-images');
// 农场阶段显示名：lib 返回稳定 key，界面按当前语言取词。
const STAGE_KEYS = { seedling: 'farm_stage_seedling', sprout: 'farm_stage_sprout', leaf: 'farm_stage_leaf', vine: 'farm_stage_vine', flower: 'farm_stage_flower', fruit: 'farm_stage_fruit' };
const CROP_KEYS = { watermelon: 'farm_crop_watermelon', strawberry: 'farm_crop_strawberry', apple: 'farm_crop_apple', pear: 'farm_crop_pear', grape: 'farm_crop_grape', kiwi: 'farm_crop_kiwi' };
// 字体大小设置（评审 P05①）：三档分段按钮（与「我的身份」样式一致），文案内联含英文，
// 选项值存 lib/store（fontScale），页面根节点挂 fs-* class 即时生效（规则在 app.wxss）。
const FONT_OPTIONS = [
  { value: 'normal', label: '标准', en: 'Standard' },
  { value: 'large', label: '大', en: 'Large' },
  { value: 'xlarge', label: '特大', en: 'Extra large' }
];
const fontCopyFor = en => en
  ? { title: 'Font size' }
  : { title: '字体大小' };

// 浇水日历：当月网格，浇水日深色，未浇水浅灰。
function buildCalendar(wateredDates, now) {
  const base = now ? new Date(now) : new Date();
  const year = base.getFullYear();
  const month = base.getMonth();
  const first = new Date(year, month, 1);
  const startWeekday = (first.getDay() + 6) % 7; // 周一开头
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const watered = new Set(wateredDates || []);
  const cells = [];
  const prevDays = new Date(year, month, 0).getDate();
  for (let i = startWeekday - 1; i >= 0; i -= 1) cells.push({ key: 'p' + i, day: prevDays - i, inMonth: false, watered: false, isToday: false });
  const todayIso = farmLib.today(base);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    cells.push({ key: 'd' + day, day, inMonth: true, watered: watered.has(iso), isToday: iso === todayIso });
  }
  let nextDay = 1;
  while (cells.length % 7 !== 0 || cells.length < 35) cells.push({ key: 'n' + nextDay, day: nextDay++, inMonth: false, watered: false, isToday: false });
  return cells;
}

Page({
  data: {
    favorites: [], settings: {}, demoSummary: { active: false }, appLanguage: 'zh',
    farm: { planted: false, stageIndex: 0, stageLabel: '', progress: 0, canWater: false, streak: 0, totalWatered: 0, daysPlanted: 1, cropLabel: '', stageNext: null, wateringsToNext: 0 },
    farmCrops: farmLib.CROPS, farmCropChoice: 'watermelon', farmCropPreview: null, watering: false, proverbVisible: false, proverb: null,
    cloudOrchard: cloudImg.img('illustrations/orchard-garden'), avatarPath: '', calendarCells: [], calendarWeekHeaders: [], calendarMonthLabel: '', showCalendar: false, L: {},
    fontScale: 'normal', fontClass: 'fs-normal', fontOptions: [], fontCopy: {}
  },
  onShareAppMessage: function () {
    return { title: i18nL.t('app_name'), path: '/pages/index/index' };
  },
  onShow: function () { i18nL.applyNav('nav_mine'); this.refresh(); },
  refresh: function () {
    const identity = store.getIdentity();
    const companion = store.getCompanion();
    const ids = store.getFavorites(); const profile = store.getProfile(); const settings = store.getSettings();
    const farm = farmLib.summary(store.capturePartition());
    const cropId = farm.crop || this.data.farmCropChoice || 'watermelon';
    const cropLabel = CROP_KEYS[farm.crop] ? i18nL.t(CROP_KEYS[farm.crop]) : farm.cropLabel;
    const en = i18nL.getLang() === 'en';
    const fontScale = store.getFontScale();
    this.setData({
      identity, companion,
      avatarPath: store.getAvatar(),
      favorites: catalog.places.filter(x => ids.indexOf(x.id) >= 0).map(contentView.placeView),
      settings,
      profile, profileTags: catalog.interests.filter(x => profile.interests.indexOf(x.id) >= 0),
      eventsCount: store.getEvents().length, demoSummary: store.getDemoSummary(),
      farmCropChoice: cropId,
      // 字体大小（评审 P05①）：读取持久化档位，根节点 class 随之更新，切换即时生效。
      fontScale, fontClass: 'fs-' + fontScale,
      fontIndex: Math.max(0, FONT_OPTIONS.map(o => o.value).indexOf(fontScale)),
      fontTickLeft: en ? 'Standard' : '标准',
      fontTickMid: en ? 'Large' : '大',
      fontTickRight: en ? 'Extra large' : '特大',
      fontCopy: fontCopyFor(en),
      farmCrops: farmLib.CROPS.map(crop => Object.assign({}, crop, { label: CROP_KEYS[crop.id] ? i18nL.t(CROP_KEYS[crop.id]) : crop.label })),
      farmMetaText: farm.planted ? i18nL.t('farm_meta', { crop: cropLabel, days: farm.daysPlanted, streak: farm.streak }) : '',
      proverbGrowthText: farm.planted ? i18nL.t('proverb_growth', { crop: cropLabel, stage: STAGE_KEYS[farm.stage.key] ? i18nL.t(STAGE_KEYS[farm.stage.key]) : farm.stage.label, total: farm.totalWatered, streak: farm.streak }) : '',
      farmCropPreview: companionLib.defaultConfig(cropId),
      appLanguage: (store.getSettings().language || 'zh'),
      L: i18nL.labels(['save','mine_notes','traveller','nickname_ph','demo_badge','demo_account','exit_demo','reset_demo','demo_entry_title','demo_entry_sub','demo_entry_btn','stat_culture','stat_places','grp_orchard','grp_harvest','grp_companion','grp_prefs','farm_calendar_toggle','avatar_set','avatar_edit','companion_pet','companion_guoling','companion_desc','start_customize','language','my_identity','role_tourist','role_farmer','settings_title','settings_note_demo','cloud_ai','cloud_ai_sub','cloud_connected_note','account_edit','account_entry','clear_data','clear_demo','footer_note','farm_calendar_title','farm_calendar_watered','farm_calendar_plain','my_farm','farm_intro','farm_watered_today','farm_water','farm_watered_btn','farm_plant','proverb_kicker','proverb_close','health_idle','health_checking','demo_desc','demo_metric_stops','demo_metric_lessons','demo_metric_cloud','avatar_fallback','mine_profile_aria','mine_share_title','cal_fav_added','fav_fail','demo_back_local','demo_reset_done','demo_entered','demo_switch_fail','settings_save_fail','clear_demo_title','clear_demo_demo_body','clear_local_body','local_data_cleared','clear_fail','switch_fail','switched_zh','farm_planted_toast','farm_plant_fail','week_1','week_2','week_3','week_4','week_5','week_6','week_7','farm_stage_seedling','farm_hint','demo_scenario_label']),
      knowledgeFavorites: store.getKnowledgeFavorites(),
      calendarCells: buildCalendar(farm.wateredDates),
      calendarWeekHeaders: ['week_1','week_2','week_3','week_4','week_5','week_6','week_7'].map(key => i18nL.t(key)),
      calendarMonthLabel: (new Date().getMonth() + 1) + i18nL.t('cal_month_suffix'),
      farm: Object.assign({}, farm, {
        cropLabel: CROP_KEYS[farm.crop] ? i18nL.t(CROP_KEYS[farm.crop]) : farm.cropLabel,
        stageLabel: farm.stage ? (STAGE_KEYS[farm.stage.key] ? i18nL.t(STAGE_KEYS[farm.stage.key]) : farm.stage.label) : '',
        stageNext: farm.stage && farm.stage.next ? (STAGE_KEYS[farm.stage.next] ? '' : '') : null,
        wateringsToNext: farm.stage ? farm.stage.wateringsToNext : 0,
        progress: farm.growthProgress || 0
      })
    });
    // stageNext 同样按语言显示
    const stageNextKey = farm.stage && farm.stage.next && STAGE_KEYS[farm.stage.next];
    if (stageNextKey) this.setData({ 'farm.stageNext': i18nL.t(stageNextKey), farmNextText: i18nL.t('farm_next', { n: farm.stage.wateringsToNext, stage: i18nL.t(stageNextKey) }) });
    else this.setData({ farmNextText: '' });
  },
  // ---- 我的资料：头像与昵称编辑移到独立子页面 ----
  openAccount: function () { wx.navigateTo({ url: '/packageMore/account/account' }); },
  enterDemo: function () { this.changeDemo('enterDemo'); },
  exitDemo: function () { this.changeDemo('exitDemo'); },
  resetDemo: function () { this.changeDemo('resetDemo'); },
  changeDemo: function (action) {
    try {
      store[action](); this.refresh();
      const bar = this.getTabBar && this.getTabBar(); if (bar) bar.setData({ demoMode: store.isDemoMode() });
      wx.showToast({ title: action === 'exitDemo' ? i18nL.t('demo_back_local') : action === 'resetDemo' ? i18nL.t('demo_reset_done') : i18nL.t('demo_entered'), icon: 'none' });
    } catch (error) { wx.showToast({ title: error.message || i18nL.t('demo_switch_fail'), icon: 'none' }); }
  },
  companion: function () { wx.navigateTo({ url: '/pages/companion/companion' }); },
  openKnowledgeFavorites: function () { wx.navigateTo({ url: '/pages/favorites/favorites?type=knowledge' }); },
  openPlaceFavorites: function () { wx.navigateTo({ url: '/pages/favorites/favorites?type=places' }); },
  // 果园卡里的浇水月历默认收起，点「查看浇水月历」就地展开/收起（不新建页面）。
  toggleCalendar: function () { this.setData({ showCalendar: !this.data.showCalendar }); },
  toggleAI: function (event) {
    // 云端开关默认开启、直接切换；发送范围见开关下方的说明文字。
    this.saveAI(event.detail.value === true);
  },
  saveAI: function (enabled) { try { store.saveSettings({ useAI: enabled }); this.refresh(); } catch (error) { wx.showToast({ title: i18nL.t('settings_save_fail'), icon: 'none' }); this.refresh(); } },





  clearData: function () {
    const that = this;
    const demo = store.isDemoMode();
    wx.showModal({ title: i18nL.t(demo ? 'clear_demo_title' : 'clear_local_title'), content: i18nL.t(demo ? 'clear_demo_demo_body' : 'clear_local_body'), confirmColor: '#B15D47', success: function (result) {
      if (!result.confirm) return;
      try { store.clearAll(); that.refresh(); wx.showToast({ title: i18nL.t('local_data_cleared') }); }
      catch (error) { that.refresh(); wx.showToast({ title: error.message || i18nL.t('clear_fail'), icon: 'none' }); }
    } });
  },
  switchRole: function (event) {
    const role = event.currentTarget.dataset.role;
    if (role === this.data.identity.role) {
      if (role === 'farmer') wx.navigateTo({ url: '/pages/seller/index' });
      return;
    }
    try {
      store.saveIdentity({ role, roleChosen: true });
      this.refresh();
      // 点“我是果农”立即跳转果农工作台（独立系统）。
      if (role === 'farmer') wx.navigateTo({ url: '/pages/seller/index' });
      else wx.showToast({ title: i18nL.t('switch_tourist'), icon: 'none' });
    }
    catch (error) { wx.showToast({ title: error.message || i18nL.t('switch_fail'), icon: 'none' }); }
  },
  // 字体大小（评审 P05①）：附件设计为滑杆——中点为当前字号，可拖动调整（允许只做「正常到变大」）。
  // 滑杆值 0/1/2 对应 标准/大/特大，拖动即保存并即时生效；保存失败提示且不改当前档。
  onFontSlider: function (event) {
    const index = event.detail.value;
    const value = FONT_OPTIONS[index] ? FONT_OPTIONS[index].value : null;
    if (!value || value === this.data.fontScale) return;
    try {
      store.saveFontScale(value);
    } catch (error) { wx.showToast({ title: error.message || i18nL.t('settings_save_fail'), icon: 'none' }); return; }
    this.refresh();
  },
  toggleAppLanguage: function () {
    const settings = store.getSettings();
    const next = (settings.language === 'en') ? 'zh' : 'en';
    store.saveSettings({ language: next });
    require('../../lib/i18n').invalidateLang();
    this.refresh();
    const bar = this.getTabBar(); if (bar && bar.applyLang) bar.applyLang();
    wx.showToast({ title: next === 'en' ? 'Switched to English' : i18nL.t('switched_zh'), icon: 'none' });
  },
  chooseFarmCrop: function (event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ farmCropChoice: id, farmCropPreview: companionLib.defaultConfig(id) });
  },
  plantFarmCrop: function () {
    try { farmLib.plant(this.data.farmCropChoice, store.capturePartition()); this.refresh(); wx.showToast({ title: i18nL.t('farm_planted_toast'), icon: 'none' }); }
    catch (error) { wx.showToast({ title: error.message || i18nL.t('farm_plant_fail'), icon: 'none' }); }
  },
  waterFarmCrop: function () {
    if (this.data.watering) return;
    const partition = store.capturePartition();
    if (!farmLib.summary(partition).canWater) { wx.showToast({ title: '今天已经浇过水啦', icon: 'none' }); return; }
    this.setData({ watering: true });
    // 浇水动画时长约 1.6s：水流+水滴+果苗轻摇，然后弹出当日农谚。
    setTimeout(() => {
      try {
        const result = farmLib.water(farmProverbs.fruitProverbForDate, partition);
        if (!result.ok) { this.setData({ watering: false }); wx.showToast({ title: result.reason || '今天已经浇过水啦', icon: 'none' }); return; }
        this.setData({ watering: false, proverbVisible: true, proverb: result.proverb && i18nL.getLang() === 'en' ? Object.assign({}, result.proverb, { text: result.proverb.en, note: result.proverb.noteEn }) : result.proverb });
        this.refresh();
      } catch (error) { this.setData({ watering: false }); wx.showToast({ title: error.message || '浇水失败，请重试', icon: 'none' }); }
    }, 1600);
  },
  closeProverb: function () { this.setData({ proverbVisible: false }); },
  noop: function () {}
});
