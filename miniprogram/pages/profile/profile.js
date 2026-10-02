const catalog = require('../../data/catalog');
const core = require('../../lib/core');
const store = require('../../lib/store');
const service = require('../../lib/service');
const geo = require('../../lib/geo');
const i18n = require('../../lib/i18n');

Page({
  noop: function () {},
  data: {
    profile: {}, text: '', parsing: false, building: false, status: '', error: '', cloudEnabled: false, originBusy: false, originStatus: '', locating: false, locationDenied: false,
    seasons: [], interestOptions: [], originOptions: [], durationOptions: [120, 180, 240, 360, 480], missingNotice: '',
    examples: [i18n.t('pf_example_text_1'), i18n.t('pf_example_text_2')]
  },
  onLoad: function () { i18n.applyNav('nav_profile');
    const cropName = value => value.split(' · ').map(part => {
      const key = Object.keys(i18n.dict).find(k => k.indexOf('fruit_') === 0 && i18n.dict[k][0] === part);
      return key ? i18n.t(key) : part;
    }).join(' · ');
    const seasons = catalog.seasons.map(item => Object.assign({}, item, {
      name: i18n.dict['season_name_' + item.id] ? i18n.t('season_name_' + item.id) : item.name,
      crop: cropName(item.crop || '')
    }));
    this.setData({ seasons, L: i18n.labels(["pf_title1","pf_title2","pf_intro","pf_local_note","pf_step2","pf_origin","pf_use_location","pf_map_pick","pf_go_settings","pf_choose_below","pf_verified_places","pf_theme","pf_date","pf_time","pf_budget","pf_party","pf_duration","pf_transport","pf_drive","pf_walk","pf_bike","pf_public_note","pf_interests","pf_extra","pf_generate","pf_privacy_note","pf_location_title","pf_location_desc","pf_allow_location","pf_manual","pf_no_origin","pf_change","pf_choose","pf_title","pf_sheet_title","pf_sheet_text","pf_sheet_allow","pf_sheet_deny","pf_clue_suffix","pf_public_status","pf_extra_ph","pf_example_1","pf_example_2","pf_planning_note","pf_footnote"]) }); this._editRevision = 0; this.setProfile(store.getProfile()); this.setData({ en: i18n.getLang() === 'en', originOptions: catalog.places.filter(place => place.routeEligible && place.location), cloudEnabled: store.getSettings().useAI }); },
  markEdited: function () { this._editRevision = (this._editRevision || 0) + 1; },
  onUnload: function () { this._disposed = true; this.cancelLocation(); },
  cancelLocation: function () { this._locationToken = (this._locationToken || 0) + 1; clearTimeout(this._locationTimer); this._locationTimer = null; if (!this._disposed) this.setData({ locating: false }); },
  setProfile: function (profile) {
    const selected = profile.interests || [];
    this.setData({
      profile: Object.assign({}, profile),
      durationHours: Number.isFinite(Number(profile.duration)) ? String(Number(profile.duration) / 60) : '',
      interestOptions: catalog.interests.map(function (interest) {
        const label = i18n.getLang() === 'en' && interest.en ? interest.en : interest.label;
        return Object.assign({}, interest, { label: label, selected: selected.indexOf(interest.id) !== -1 });
      })
    });
  },
  onTextInput: function (event) { this.markEdited(); this.setData({ text: event.detail.value }); },
  useExample: function (event) { this.markEdited(); this.setData({ text: this.data.examples[Number(event.currentTarget.dataset.index)] }); },
  parse: function () {
    const page = this;
    const text = this.data.text.trim();
    if (!text) { this.setData({ error: i18n.t('pf_need_text') }); return; }
    if (this.data.parsing) return;
    this.setData({ parsing: true, error: '', status: i18n.t('pf_parsing') });
    const revision = this._editRevision || 0;
    const base = Object.assign({}, this.data.profile, { budget: Number(this.data.profile.budget), partySize: Number(this.data.profile.partySize), duration: Number(this.data.profile.duration) });
    service.parseProfile(text, base).then(function (result) {
      if (page._disposed) return;
      if ((page._editRevision || 0) !== revision) {
        page.setData({ parsing: false, status: i18n.t('pf_manual_kept'), missingNotice: '' });
        return;
      }
      page.setProfile(Object.assign({}, result.profile, { origin: base.origin || null }));
      const isAI = result.mode === 'openai-compatible';
      const labels = { date: i18n.t('pf_f_date'), startTime: i18n.t('pf_f_start'), duration: i18n.t('pf_f_duration'), budget: i18n.t('pf_f_budget'), partySize: i18n.t('pf_f_party'), transport: i18n.t('pf_f_transport'), interests: i18n.t('pf_f_interests'), season: i18n.t('pf_f_season'), walking: i18n.t('pf_f_walking') };
      const missing = result.missingFields.map(function (field) { return labels[field]; }).filter(Boolean);
      page.setData({ status: (isAI ? i18n.t('pf_status_ai') : i18n.t('pf_status_local')) + i18n.t('pf_status_tail') + (result.fallbackReason ? '（' + result.fallbackReason + '）' : ''), parsing: false, missingNotice: missing.length ? i18n.t('pf_missing_head') + missing.join('、') + i18n.t('pf_missing_tail') : '' });
    }).catch(function () {
      if (!page._disposed) page.setData({ parsing: false, status: '', error: i18n.t('pf_parse_fail') });
    });
  },
  setField: function (event) {
    const field = event.currentTarget.dataset.field;
    if (!['date', 'startTime', 'duration', 'budget', 'partySize'].includes(field)) return;
    this.markEdited();
    const patch = {};
    patch['profile.' + field] = event.detail.value;
    this.setData(patch);
  },
  chooseSeason: function (event) {
    const season = event.currentTarget.dataset.id;
    if (!catalog.seasons.some(item => item.id === season)) return;
    this.markEdited();
    this.setData({ 'profile.season': season });
  },
  chooseValue: function (event) {
    if (!['duration', 'transport', 'walking'].includes(event.currentTarget.dataset.field)) return;
    this.markEdited();
    const patch = {};
    patch['profile.' + event.currentTarget.dataset.field] = event.currentTarget.dataset.value;
    this.setData(patch);
  },
  toggleInterest: function (event) {
    const id = event.currentTarget.dataset.id;
    if (!catalog.interests.some(item => item.id === id)) return;
    this.markEdited();
    const interests = this.data.profile.interests.slice();
    const index = interests.indexOf(id);
    if (index === -1) interests.push(id); else interests.splice(index, 1);
    this.setProfile(Object.assign({}, this.data.profile, { interests: interests }));
  },
  availableOrigins: function () { return catalog.places.filter(place => place.routeEligible && place.location); },
  selectOriginPlace: function (id) {
    if (this.data.originBusy || this._disposed) return;
    const place = this.availableOrigins().find(item => item.id === id);
    if (!place) return;
    this.cancelLocation();
    this.markEdited();
    this.setData({ 'profile.origin': { name: place.name, address: place.address || '', latitude: place.location.latitude, longitude: place.location.longitude, coordinateSystem: 'gcj02', source: 'catalog' }, error: '', originStatus: i18n.t('pf_origin_picked') });
  },
  chooseQuickOrigin: function (event) { this.selectOriginPlace(event.currentTarget.dataset.id); },
  chooseOrigin: function () {
    if (this.data.originBusy || this._originMenuOpen) return;
    const page = this;
    // Read current catalog even after a developer-tool hot reload with old page data.
    const places = this.availableOrigins();
    this.setData({ originOptions: places });
    this._originMenuOpen = true;
    wx.showActionSheet({ itemList: places.map(place => place.name).concat(i18n.t('pf_map_pick_title')), success: function (result) {
      page._originMenuOpen = false;
      if (page._disposed) return;
      const place = places[result.tapIndex];
      if (place) { page.selectOriginPlace(place.id); return; }
      if (result.tapIndex === places.length) page.chooseMapOrigin();
    }, fail: function () { page._originMenuOpen = false; }, complete: function () { page._originMenuOpen = false; } });
  },
  chooseMapOrigin: function () {
    if (this.data.originBusy || this._disposed) return;
    const page = this;
    this.cancelLocation();
    this.setData({ originBusy: true, originStatus: i18n.t('pf_map_opening'), error: '' });
    const finish = function () { if (!page._disposed) page.setData({ originBusy: false }); };
    try {
      wx.chooseLocation({ success: function (location) {
        if (page._disposed) return;
        if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
          page.setData({ error: i18n.t('pf_map_invalid'), originStatus: '' }); finish(); return;
        }
        page.markEdited();
        page.setData({ 'profile.origin': { name: location.name || i18n.t('pf_map_origin_name'), address: location.address || '', latitude: location.latitude, longitude: location.longitude, coordinateSystem: 'gcj02', source: 'user' }, error: '', originStatus: i18n.t('pf_map_saved') });
        finish();
      }, fail: function (error) {
        if (!page._disposed) page.setData({ originStatus: /cancel/.test(error && error.errMsg || '') ? i18n.t('pf_map_cancelled') : '', error: /cancel/.test(error && error.errMsg || '') ? '' : i18n.t('pf_map_unavailable') });
        finish();
      }, complete: finish });
    } catch (error) { if (!page._disposed) page.setData({ originStatus: '', error: i18n.t('pf_map_unavailable_short') }); finish(); }
  },
  useCurrentLocation: function () {
    if (this._disposed || this.data.originBusy || this.data.locating || this._locationExplanationOpen) return;
    if (typeof wx.getLocation !== 'function') { this.setData({ error: i18n.t('pf_locate_unsupported') }); return; }
    const page = this;
    const begin = function () { if (!page._disposed) page.startLocation(); };
    if (this._locationExplained) { begin(); return; }
    // 授权说明用屏幕下半部的自绘弹层（系统授权弹窗仍由微信弹出）。
    this._pendingLocationBegin = begin;
    this.setData({ locationSheet: true });
  },
  closeLocationSheet: function () { this.setData({ locationSheet: false }); this._pendingLocationBegin = null; },
  allowLocation: function () {
    this.setData({ locationSheet: false });
    this._locationExplained = true;
    if (this._pendingLocationBegin) { const begin = this._pendingLocationBegin; this._pendingLocationBegin = null; begin(); }
  },
  startLocation: function () {
    this.cancelLocation();
    const page = this, token = this._locationToken, partition = store.isDemoMode();
    this.setData({ locating: true, locationDenied: false, originStatus: i18n.t('pf_locating'), error: '' });
    const current = function () { return !page._disposed && store.isDemoMode() === partition && page._locationToken === token && page.data.locating; };
    const fail = function (error) {
      if (!current()) return;
      clearTimeout(page._locationTimer);
      const state = geo.locationFailure(error);
      page.setData({ locating: false, locationDenied: state.settings, originStatus: state.message, error: '' });
    };
    this._locationTimer = setTimeout(function () { fail({ errMsg: 'getLocation:fail timeout' }); }, 12000);
    const locate = function () {
      if (!current()) return;
      try { wx.getLocation({ type: 'gcj02', isHighAccuracy: false,
        success: function (location) {
          if (!current()) return;
          const origin = { name: i18n.t('pf_my_location'), address: i18n.t('pf_my_location_note'), latitude: location.latitude, longitude: location.longitude, coordinateSystem: 'gcj02', source: 'user' };
          if (!geo.validOrigin(origin)) { fail({ errMsg: 'getLocation:fail invalid coordinates' }); return; }
          clearTimeout(page._locationTimer); page.markEdited();
          page.setData({ 'profile.origin': origin, locating: false, locationDenied: false, originStatus: i18n.t('pf_location_used'), error: '' });
        }, fail: fail }); } catch (error) { fail(error); }
    };
    if (typeof wx.getSetting !== 'function') { locate(); return; }
    try { wx.getSetting({ success: function (settings) {
      if (!current()) return;
      if (settings.authSetting && settings.authSetting['scope.userLocation'] === false) { fail({ errMsg: 'getLocation:fail auth deny' }); return; }
      locate();
    }, fail: fail }); } catch (error) { fail(error); }
  },
  openLocationSettings: function () {
    if (typeof wx.openSetting !== 'function') { this.setData({ originStatus: i18n.t('pf_settings_fail') }); return; }
    const page = this;
    wx.openSetting({ success: function (result) {
      if (page._disposed) return;
      const allowed = !!(result.authSetting && result.authSetting['scope.userLocation']);
      page.setData({ locationDenied: !allowed, originStatus: allowed ? i18n.t('pf_perm_granted') : i18n.t('pf_perm_denied') });
    }, fail: function () { if (!page._disposed) page.setData({ originStatus: i18n.t('pf_settings_fail_short') }); } });
  },
  setHours: function (event) {
    this.markEdited();
    const hours = Number(event.detail.value);
    if (Number.isFinite(hours) && hours > 0) {
      this.setData({ durationHours: String(hours), profile: Object.assign({}, this.data.profile, { duration: Math.round(hours * 60) }) });
    } else this.setData({ durationHours: event.detail.value });
  },
  createRoute: function () {
    if (this.data.parsing || this.data.building) return;
    const profile = Object.assign({}, this.data.profile, {
      duration: Number(this.data.profile.duration), budget: Number(this.data.profile.budget),
      partySize: Number(this.data.profile.partySize), note: this.data.text.trim() || this.data.profile.note || ''
    });
    if (!Number.isFinite(profile.budget) || String(this.data.profile.budget).trim() === '' || profile.budget < 0 || profile.budget > 100000) {
      this.setData({ error: i18n.t('pf_budget_range') }); return;
    }
    if (!Number.isInteger(profile.partySize) || profile.partySize < 1 || profile.partySize > 20) {
      this.setData({ error: i18n.t('pf_party_range') }); return;
    }
    this.setData({ error: '', building: true });
    try {
      store.saveProfile(profile);
      const route = core.generateRoute(profile);
      if (!route.ok) {
        store.saveRoute(null);
        this.setData({ error: route.reason || i18n.t('pf_no_solution'), building: false });
        return;
      }
      store.saveRoute(route);
      try { store.logEvent('route_generate', { season: profile.season, ok: route.ok }); } catch (error) {}
      wx.switchTab({ url: '/pages/route/route' });
    } catch (error) { this.setData({ error: error.message || i18n.t('pf_incomplete') }); }
    this.setData({ building: false });
  }
});
