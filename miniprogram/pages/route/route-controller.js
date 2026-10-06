const catalog = require('../../data/catalog');
const core = require('../../lib/core');
const store = require('../../lib/store');
const presentation = require('../../lib/route-presentation');
const flow = require('../../lib/visitor-flow');
const learning = require('../../data/learning');
const i18n = require('../../lib/i18n');

function englishDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return i18n.t('rt_tbd_short');
  const parsed = new Date(date + 'T12:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return i18n.t('rt_tbd_short');
  return i18n.t('cal_month_' + (parsed.getUTCMonth() + 1)) + ' ' + parsed.getUTCDate() + ' · ' + ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][parsed.getUTCDay()];
}

function englishDuration(minutes) {
  if (!Number.isInteger(minutes) || minutes < 0) return '';
  const hours = Math.floor(minutes / 60), remainder = minutes % 60;
  return hours ? hours + 'h' + (remainder ? ' ' + remainder + i18n.t('rt_min') : '') : remainder + i18n.t('rt_min');
}

module.exports = function createRoutePage(options) {
  const isDetail = !!(options && options.detail);
  return {
  data: {
    isDetail, en: false, currentStop: null, route: null, profile: {}, stops: [], excludedIds: [], sources: [], sourceVisible: false,
    error: '', seasonTitle: '', transportLabel: '', warningList: [],
    routeMap: { markers: [], polyline: [], includePoints: [], center: null }, previewPlaces: [], activeStopId: '', mapVisible: true, detailsVisible: false, editing: false,
    dateLabel: '', durationLabel: '', visitCost: null, visitCostKnown: false
  },
  onLoad: function (options) {
    if (isDetail && options && options.stop) this.setData({ activeStopId: options.stop });
  },
  onShow: function () {
 this.setData({ fontClass: typeof getApp === 'function' && getApp() ? getApp().getFontClass() : 'fs-normal' });     i18n.applyNav('nav_route');
    this.setData({ en: i18n.getLang() === 'en' });
    const tab = this.getTabBar && this.getTabBar();
    if (tab) tab.setData({ selected: 3 });
    this.setData({ L: i18n.labels(['route_title','trip_extra','trip_extra_hint','trip_generate','trip_duration','trip_theme','rt_title','rt_adjust','rt_empty_title','rt_empty_desc','rt_map_sites','rt_map_preview','rt_tap_read_story','rt_start_planning','rt_start_hint','rt_no_solution_title','rt_modify_conditions','rt_restore_stops','rt_cost_tbd','rt_ticket_cost','rt_cost_venue','rt_transport_cost','rt_budget_label','rt_history_note','rt_trip_map','rt_map_collapse','rt_map_expand','rt_map_cap_venue','rt_tap_marker','rt_stops_title','rt_edit_trip','rt_edit_done','rt_reorder','rt_adjust_prefs','rt_skip_hint','rt_skip_stop','rt_experiences','rt_read_story','rt_navigate','rt_trip_end','rt_time_note','rt_details_title','rt_wait_note','rt_restore_skipped','rt_return_to','rt_return_duration','rt_cost_free','rt_tbd_short','rt_add_aria','rt_adjust_aria','rt_arrive_a','rt_arrive_b','rt_cost_known','rt_depart','rt_dwell','rt_map_view','rt_map_word','rt_min','rt_min_end','rt_no_solution_hint','rt_per_person_a','rt_per_person_b','rt_restore_unit','rt_roundtrip','rt_stops_unit','rt_wait_short']) });
    this.refresh();
  },
  refresh: function () { this.applyRoute(store.getRoute()); },
  applyRoute: function (route, excludedIds) {
    const profile = route && route.profileSnapshot || store.getProfile();
    const season = catalog.seasons.find(function (item) { return item.id === profile.season; });
    const view = presentation.buildRoutePresentation(route, profile);
    const map = route ? view.map : presentation.buildCatalogMap();
    const oldId = this.data.activeStopId;
    const en = i18n.getLang() === 'en';
    const transportKey = { drive: 'pf_drive', walk: 'pf_walk', bike: 'pf_bike' }[profile.transport];
    const enNameOf = stop => {
      if (!en) return stop.displayName;
      const place = catalog.places.find(item => item.id === stop.placeId);
      return place && place.enName ? place.enName : stop.displayName;
    };
    const activeStopId = view.stops.some(function (stop) { return stop.placeId === oldId; }) ? oldId : view.stops.length ? view.stops[0].placeId : '';
    const displayStops = view.stops.map(stop => Object.assign({}, stop, { displayName: enNameOf(stop) }));
    this.setData({
      profile: profile, route: route, stops: displayStops, currentStop: displayStops.find(stop => stop.placeId === activeStopId) || displayStops[0] || null,
      routeMap: route ? presentation.activeMap(map, activeStopId) : map, activeStopId: activeStopId,
      previewPlaces: catalog.places.filter(place => place.routeEligible && place.location).map(place => ({ id: place.id, name: place.name })),
      excludedIds: excludedIds || route && route.excludedIds || [],
      seasonTitle: season ? i18n.t('season_name_' + season.id) : i18n.t('rt_countryside'),
      transportLabel: transportKey ? i18n.t(transportKey) : view.transportLabel,
      dateLabel: en ? englishDate(profile.date) : view.dateLabel,
      durationLabel: en ? englishDuration(route && route.totalMinutes) : view.durationLabel,
      visitCost: view.stops.every(stop => typeof stop.cost === 'number') ? view.stops.reduce((total, stop) => total + stop.cost, 0) : null,
      visitCostKnown: view.stops.length > 0 && view.stops.every(stop => typeof stop.cost === 'number'),
      warningList: route && route.warnings || [], sourceVisible: false, sources: [], error: ''
    });
  },
  openFullRoute: function () {
    const stop = this.data.currentStop;
    wx.navigateTo({ url: '/packageMore/route-detail/route-detail' + (stop ? '?stop=' + encodeURIComponent(stop.placeId) : '') });
  },
  // 评审 9.28：行程定制统一走分步向导（与 P24 的 openWizard 一致），旧偏好表单不再作为行程入口。
  editProfile: function () { wx.navigateTo({ url: '/packageTrip/pages/trip-wizard/trip-wizard' }); },
  regenerate: function () { this.build(this.data.excludedIds); },
  resetStops: function () { this.build([]); },
  build: function (excludedIds) {
    try {
      // Reordering edits the displayed trip, even if another page changed future preferences.
      const profile = this.data.profile && this.data.profile.season ? this.data.profile : store.getProfile();
      const route = core.generateRoute(profile, { excludedIds: excludedIds });
      if (!route.ok) {
        route.profileSnapshot = JSON.parse(JSON.stringify(profile));
        route.excludedIds = excludedIds.slice();
      }
      store.saveRoute(route.ok ? route : null);
      this.applyRoute(route, excludedIds);
      if (route.ok) {
        // Feeds the device-level visitor-flow signal used by the seller AI view.
        try { flow.recordTrip(route); } catch (error) { /* 信号采集失败不影响行程 */ }
        try { store.logEvent('route_recalculate', { excludedIds: excludedIds.slice(), ok: true }); } catch (error) {}
        wx.showToast({ title: i18n.t('rt_updated'), icon: 'success' });
      }
    } catch (error) { this.setData({ error: error.message || i18n.t('rt_update_fail') }); }
  },
  selectStop: function (event) {
    const id = event.currentTarget.dataset.id;
    if (!this.data.stops.some(function (stop) { return stop.placeId === id; })) return;
    this.applySelection(this.data.activeStopId === id ? '' : id);
  },
  selectMapStop: function (event) {
    const id = event.currentTarget.dataset.id;
    if (!this.data.stops.some(function (stop) { return stop.placeId === id; })) return;
    this.selectAndScroll(id);
  },
  openPreviewPlace: function (event) {
    const id = event.currentTarget.dataset.id;
    if (!this.data.route && catalog.places.some(place => place.id === id && place.routeEligible)) wx.navigateTo({ url: '/pages/culture/culture?id=' + encodeURIComponent(id) });
  },
  onPreviewMarkerTap: function (event) {
    if (this.data.route) return;
    const marker = this.data.routeMap.markers.find(item => item.id === (event.detail && event.detail.markerId));
    if (marker) this.openPreviewPlace({ currentTarget: { dataset: { id: marker.placeId } } });
  },
  onMarkerTap: function (event) {
    const markerId = event && event.detail && event.detail.markerId;
    const marker = this.data.routeMap.markers.find(function (item) { return item.id === markerId; });
    if (!marker || !this.data.stops.some(function (stop) { return stop.placeId === marker.placeId; })) return;
    this.selectAndScroll(marker.placeId);
  },
  selectAndScroll: function (id) {
    this.applySelection(id, function () {
      if (isDetail) wx.pageScrollTo({ selector: '#stop-' + id, offsetTop: -18, duration: 250 });
    });
  },
  applySelection: function (id, callback) {
    this.setData({ activeStopId: id, currentStop: this.data.stops.find(stop => stop.placeId === id) || this.data.stops[0] || null, routeMap: presentation.activeMap(this.data.routeMap, id) }, callback);
  },
  navigateToStop: function (event) {
    const id = event.currentTarget.dataset.id;
    const stop = this.data.stops.find(function (item) { return item.placeId === id; });
    if (!stop || !stop.location) return;
    try { store.logEvent('stop_navigate', { placeId: id, simulated: false }); } catch (error) {}
    wx.openLocation({
      latitude: stop.location.latitude, longitude: stop.location.longitude,
      name: stop.displayName, address: stop.address || '', scale: 15,
      fail: function (error) { if (!/cancel/.test(error.errMsg || '')) this.setData({ error: i18n.t('rt_map_fail') }); }.bind(this)
    });
  },
  toggleEditing: function () { this.setData({ editing: !this.data.editing }); },
  openExperiences: function (event) {
    const id = event.currentTarget.dataset.id;
    if (!this.data.stops.some(stop => stop.placeId === id)) return;
    const lesson = learning.forPlace(id);
    if (lesson) { wx.navigateTo({ url: lesson.url }); return; }
    wx.showModal({ title: i18n.t('rt_exp_title'), content: i18n.t('rt_exp_body'), showCancel: false, confirmText: i18n.t('rt_exp_ok') });
  },
  toggleMap: function () { this.setData({ mapVisible: !this.data.mapVisible }); },
  toggleDetails: function () { this.setData({ detailsVisible: !this.data.detailsVisible }); },
  openStopMenu: function (event) {
    const id = event.currentTarget.dataset.id;
    const stop = this.data.stops.find(function (item) { return item.placeId === id; });
    if (!stop) return;
    const choices = [i18n.t('rt_skip_reorder')];
    wx.showActionSheet({ itemList: choices, success: function (result) {
      if (!this.data.stops.some(function (item) { return item.placeId === id; })) return;
      const choice = choices[result.tapIndex];
      if (result.tapIndex === 0) this.excludeStop(event);
    }.bind(this) });
  },
  excludeStop: function (event) {
    const id = event.currentTarget.dataset.id;
    if (!catalog.places.some(function (place) { return place.id === id; })) return;
    const excluded = this.data.excludedIds.slice();
    if (excluded.indexOf(id) === -1) excluded.push(id);
    this.build(excluded);
  },
  openStop: function (event) {
    const id = event.currentTarget.dataset.id;
    if (this.data.stops.some(function (stop) { return stop.placeId === id; })) wx.navigateTo({ url: '/pages/culture/culture?id=' + encodeURIComponent(id) });
  },
  viewSource: function (event) {
    const fact = catalog.facts.find(function (item) { return item.id === event.currentTarget.dataset.fact; });
    if (!fact) return;
    this.setData({ sources: catalog.sources.filter(function (source) { return fact.sourceIds.indexOf(source.id) !== -1; }), sourceVisible: true });
  },
  closeSource: function () { this.setData({ sourceVisible: false }); },
  copySource: function (event) {
    const source = this.data.sources.find(function (item) { return item.id === event.currentTarget.dataset.id; });
    if (source) wx.setClipboardData({ data: source.url });
  },
  noop: function () {}
  };
};
