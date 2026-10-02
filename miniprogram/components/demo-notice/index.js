const store = require('../../lib/store');
const i18n = require('../../lib/i18n');

Component({
  properties: { forceChinese: { type: Boolean, value: false } },
  data: { active: false, L: {} },
  lifetimes: {
    attached: function () { this.refreshMode(); }
  },
  pageLifetimes: {
    show: function () { this.refreshMode(); }
  },
  methods: {
    refreshMode: function () { this.setData({ active: store.isDemoMode(), L: this.properties && this.properties.forceChinese ? { comp_demo_banner: i18n.dict.comp_demo_banner[0], comp_demo_aria: i18n.dict.comp_demo_aria[0] } : i18n.labels(['comp_demo_banner','comp_demo_aria']) }); },
    openAccount: function () { wx.navigateTo({ url: '/pages/mine/mine' }); }
  }
});
