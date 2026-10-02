const companion = require('../../lib/companion');
Component({
  properties: { crop: { type: String, value: 'watermelon' }, days: { type: Number, value: 0 } },
  data: { stage: 0, form: 'vine', fruit: null, scale: .8 },
  observers: {
    'crop,days': function (crop, days) {
      const stage = days >= 30 ? 5 : days >= 18 ? 4 : days >= 10 ? 3 : days >= 5 ? 2 : days >= 2 ? 1 : 0;
      this.setData({ stage, scale: .8 + Math.max(0, Math.min(30, days)) / 100, form: ['apple', 'pear'].includes(crop) ? 'tree' : crop === 'strawberry' ? 'bush' : 'vine', fruit: companion.defaultConfig(crop) });
    }
  }
});
