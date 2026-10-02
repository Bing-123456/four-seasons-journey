const heritage = require('../../data/heritage');
const mill = require('../../components/heritage-viewer/grain-mill');
const store = require('../../lib/store');
const i18n = require('../../lib/i18n');

Page({
  onShow: function () { this.setData({ fontClass: typeof getApp === 'function' && getApp() ? getApp().getFontClass() : 'fs-normal' }); },
  data: {
    artifact: heritage.artifacts[0], isMill: true, started: false, textMode: false,
    ready: false, error: '', textureWarning: '', autoRotate: false, zoomPercent: 100,
    triangleCount: 0, vertexCount: 0, position: 0, strokes: 0, lastEnd: 0,
    progressPercent: 0, cameraView: 'overview', motionHint: '',
    answer: '', answerCorrect: false, completed: false, step: 0, animating: false
  },
  onLoad: function () {
    this.setData({ motionHint: i18n.t('hg_motion_far'), L: i18n.labels(['hg_title','hg_exhibit_a','hg_exhibit_b','hg_cover_invite','hg_strokes_unit','hg_try_3d','hg_switch_text','hg_answer_right','hg_answer_wrong','hg_subtitle','hg_text_mode','hg_3d_mode','hg_roller','hg_slab','hg_schematic','hg_push_hint','hg_try','hg_see_text','hg_3d_fail','hg_continue','hg_answer_prompt','hg_view_front','hg_view_top','hg_view_side','hg_reset','hg_roll_hint','hg_pull_back','hg_push_far','hg_switch','hg_schematic_note','hg_keep_note','hg_done','hg_field_to_table','hg_explore_next','hg_sauce_note']) });
    const artifact = heritage.artifacts[0];
    this.setData({ artifact: artifact, isMill: true, started: false, autoRotate: false });
    wx.setNavigationBarTitle({ title: i18n.t('hg_title') });
    try { store.logEvent('heritage_open', { mode: artifact.id }); } catch (error) {}
  },
  onUnload: function () { this.stopMotion(); },
  onHide: function () { this.stopMotion(); },
  stopMotion: function () { if (this._motionTimer) clearInterval(this._motionTimer); this._motionTimer = null; if (this.data.animating) this.setData({ animating: false }); },
  startLesson: function () { this.setData({ started: true, textMode: false, ready: false, error: '' }); },
  onViewerReady: function (event) {
    this.setData({ ready: true, error: '', triangleCount: event.detail.triangleCount, vertexCount: event.detail.vertexCount });
    if (this.data.isMill) { const viewer = this.viewer(); if (viewer) { viewer.setPosition(this.data.position, this.data.progressPercent / 100); viewer.setCamera(this.data.cameraView); } }
  },
  onViewerError: function (event) { this.stopMotion(); this.setData({ error: event.detail.message, ready: false, textMode: this.data.isMill }); },
  onTextureError: function (event) { this.setData({ textureWarning: event.detail.message }); },
  onViewChange: function (event) { this.setData({ autoRotate: event.detail.autoRotate, zoomPercent: Math.round(event.detail.zoom * 100) }); },
  viewer: function () { return this.selectComponent('#artifact-viewer'); },
  zoomIn: function () { const viewer = this.viewer(); if (viewer) viewer.zoom(1.15); },
  zoomOut: function () { const viewer = this.viewer(); if (viewer) viewer.zoom(1 / 1.15); },
  rotateLeft: function () { const viewer = this.viewer(); if (viewer) viewer.rotate(-0.4, 0); },
  rotateRight: function () { const viewer = this.viewer(); if (viewer) viewer.rotate(0.4, 0); },
  toggleAuto: function () { const viewer = this.viewer(); if (viewer) viewer.setAutoRotate(!this.data.autoRotate); },
  resetView: function () {
    this.stopMotion();
    if (this.data.isMill) this.setData({ position: 0, strokes: 0, lastEnd: 0, progressPercent: 0, cameraView: 'overview', answer: '', answerCorrect: false, completed: false, step: 0, motionHint: i18n.t('hg_motion_far') });
    const viewer = this.viewer();
    if (viewer) { viewer.reset(); if (this.data.isMill) viewer.setPosition(0, 0); }
  },
  setCamera: function (event) {
    const name = event && event.currentTarget && event.currentTarget.dataset.view;
    if (!Object.prototype.hasOwnProperty.call(mill.CAMERA_VIEWS, name)) return;
    this.setData({ cameraView: name }); const viewer = this.viewer(); if (viewer) viewer.setCamera(name);
  },
  applyPosition: function (position) {
    const next = mill.updateMotion({ position: this.data.position, lastEnd: this.data.lastEnd, strokes: this.data.strokes }, position);
    const progress = next.strokes * 25;
    this.setData({ position: next.position, lastEnd: next.lastEnd, strokes: next.strokes, progressPercent: progress,
      motionHint: next.strokes >= 4 ? i18n.t('hg_motion_done') : next.lastEnd === 100 ? i18n.t('hg_motion_pull') : i18n.t('hg_motion_push') });
    const viewer = this.viewer(); if (viewer) viewer.setPosition(next.position, progress / 100);
  },
  moveGrind: function (event) { this.stopMotion(); this.applyPosition(event.detail.value); },
  grindForward: function () { this.animateTo(100); },
  grindBack: function () { this.animateTo(0); },
  animateTo: function (target) {
    if (!this.data.ready || this.data.textMode) return;
    this.stopMotion();
    const page = this, from = this.data.position, start = Date.now();
    if (Math.abs(from - target) < 1) return;
    this.setData({ animating: true });
    this._motionTimer = setInterval(function () {
      const elapsed = Math.min(1, (Date.now() - start) / 650), t = elapsed * elapsed * (3 - 2 * elapsed);
      page.applyPosition(from + (target - from) * t);
      if (elapsed >= 1) page.stopMotion();
    }, 40);
  },
  toggleTextMode: function () { this.stopMotion(); this.setData({ textMode: !this.data.textMode, started: true, ready: false, error: '' }); },
  nextTextStep: function () { this.setData({ step: Math.min(2, this.data.step + 1) }); },
  answerQuestion: function (event) {
    if (!this.data.isMill || !this.data.started || !(this.data.strokes >= 2 || this.data.textMode && this.data.step === 2) || this.data.completed) return;
    const answer = event && event.currentTarget && event.currentTarget.dataset.answer;
    if (!this.data.artifact.choices.some(function (choice) { return choice.id === answer; })) return;
    const correct = answer === 'rolling';
    this.setData({ answer: answer, answerCorrect: correct, completed: correct });
    if (correct) {
      try { store.logEvent('heritage_lesson_complete', { mode: this.data.textMode ? 'text' : '3d', count: this.data.strokes, ok: true }); } catch (error) { /* Completion remains usable when device storage is unavailable. */ }
    }
  },
  copySource: function () { wx.setClipboardData({ data: this.data.artifact.sourceUrl }); },
  exploreExperience: function () { wx.navigateTo({ url: this.data.artifact.experienceLink }); }
});
