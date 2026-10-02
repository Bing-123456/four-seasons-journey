const millModule = require('./grain-mill');

function point(touch) { return { x: touch.x === undefined ? touch.clientX : touch.x, y: touch.y === undefined ? touch.clientY : touch.y }; }
function distance(touches) { const a = point(touches[0]), b = point(touches[1]); return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2)); }

Component({
  properties: { scene: { type: String, value: 'grain-mill' } },
  data: { loading: true, error: '', L: {} },
  lifetimes: {
    ready: function () { this.setData({ L: require('../../lib/i18n').labels(['hv_loading_mill','hv_loading_generic','hv_caption_mill','hv_caption_generic']) }); this.initialize(); },
    detached: function () { this._disposed = true; if (this._renderer) this._renderer.destroy(); this._renderer = null; }
  },
  pageLifetimes: {
    show: function () { if (this._renderer) this._renderer.start(); },
    hide: function () { if (this._renderer) this._renderer.stop(); }
  },
  methods: {
    initialize: function () {
      const component = this;
      this.createSelectorQuery().select('#heritage-canvas').fields({ node: true, size: true }).exec(function (result) {
        if (component._disposed) return;
        const item = result && result[0];
        try {
          if (!item || !item.node || !item.width || !item.height) throw new Error('3D 画布暂未准备好，请重新进入');
          const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
          if (component.data.scene === 'grain-mill') {
            component._renderer = new millModule.GrainMillRenderer(item.node, item.width, item.height, info.pixelRatio);
            const mesh = millModule.createMillMesh(0, 0);
            component.setData({ loading: false });
            component.triggerEvent('ready', { vertexCount: mesh.vertexCount, triangleCount: mesh.triangleCount });
          } else { throw new Error('只提供有河南资料依据的农具课堂'); }
        } catch (error) { component.fail(error.message); }
      });
    },
    fail: function (message) {
      if (this._disposed) return;
      this.setData({ loading: false, error: message });
      this.triggerEvent('error', { message: message });
    },
    emitView: function () { if (this._renderer) this.triggerEvent('viewchange', Object.assign({}, this._renderer.view)); },
    setPosition: function (position, progress) { if (this._renderer && this._renderer.setPosition) this._renderer.setPosition(position, progress); },
    setCamera: function (name) { if (this._renderer && this._renderer.camera) { this._renderer.camera(name); this.emitView(); } },
    rotate: function (x, y) { if (this._renderer) { this._renderer.action('rotate', x, y); this.emitView(); } },
    zoom: function (factor) { if (this._renderer) { this._renderer.action('zoom', factor); this.emitView(); } },
    reset: function () { if (this._renderer) { this._renderer.action('reset'); this.emitView(); } },
    setAutoRotate: function (value) { if (this._renderer) { this._renderer.action('auto', value); this.emitView(); } },
    touchStart: function (event) {
      if (!this._renderer) return;
      this._renderer.interacting = true;
      this._touch = event.touches.length > 1 ? { distance: distance(event.touches) } : point(event.touches[0]);
    },
    touchMove: function (event) {
      if (!this._renderer || !this._touch || !event.touches.length) return;
      if (event.touches.length > 1) {
        const current = distance(event.touches);
        if (this._touch.distance > 0) this.zoom(current / this._touch.distance);
        this._touch = { distance: current };
      } else {
        const current = point(event.touches[0]);
        if (this._touch.x !== undefined) this.rotate((current.x - this._touch.x) * 0.009, (current.y - this._touch.y) * 0.007);
        this._touch = current;
      }
    },
    touchEnd: function () { if (this._renderer) this._renderer.interacting = false; this._touch = null; this.emitView(); }
  }
});
