'use strict';

const world = require('../../data/sites');
const i18n = require('../../../lib/i18n');

Page({
  data: { sites: [], expandedId: '', L: {} },
  onLoad: function () {
    i18n.applyNav('wd_title');
    const en = i18n.getLang() === 'en';
    this.setData({ L: i18n.labels(['wd_title','wd_head_a','wd_head_b','wd_intro','wd_scope_note','wd_notes','wd_sources','wd_copy_link','wd_end','wd_back','wd_expand','collapse']), sites: world.sites.map(site => Object.assign({}, site,
      en && site.enCountry ? { country: site.enCountry } : {},
      en && site.enContinent ? { continent: site.enContinent } : {},
      en && site.enTheme ? { theme: site.enTheme } : {},
      en && site.enDesignation ? { designation: site.enDesignation } : {},
      en && site.enDescription ? { description: site.enDescription } : {},
      { continents: site.enContinent || site.continent, factCount: site.facts.length },
      en ? { facts: site.facts.map(fact => Object.assign({}, fact, { text: fact.enText || fact.text })) } : {}
    )) });
  },
  toggleSite: function (event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ expandedId: this.data.expandedId === id ? '' : id });
  },
  copySource: function (event) {
    const url = event.currentTarget.dataset.url;
    if (url) wx.setClipboardData({ data: url });
  },
  backHome: function () { wx.switchTab({ url: '/pages/index/index' }); }
});
