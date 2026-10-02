const i18n = require('../lib/i18n');
Component({
  lifetimes: { attached() { this.applyLang(); } },
  pageLifetimes: { show() { this.applyLang(); } },
  data: {selected: 0, tabs: [
    {path:'/pages/index/index',labelKey:'tab_discover',label:'发现',icon:'discover'},
    {path:'/pages/calendar/calendar',labelKey:'tab_calendar',label:'四时',icon:'leaf'},
    {path:'/pages/learn/learn',labelKey:'tab_games',label:'游戏',icon:'learn'},
    {path:'/pages/route/route',labelKey:'tab_route',label:'行程',icon:'route'}
  ]},
  methods: {
    applyLang() {
      const tabs = this.data.tabs.map(t => Object.assign({}, t, { label: i18n.t(t.labelKey) }));
      this.setData({ tabs });
    },
    switchTab: function(e) {
      const i=Number(e.currentTarget.dataset.index);
      if(i===this.data.selected) return;
      wx.switchTab({url:this.data.tabs[i].path});
    }
  }
});
