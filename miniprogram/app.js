const welcome = require('./lib/welcome');
const store = require('./lib/store');
// 云托管环境 ID；小程序端通过 wx.cloud.callContainer 直连服务，无需在公众平台配置服务器域名。
const CLOUD_RUN_ENV = 'prod-d8gw4a7vm69f14375';
// 云开发环境（cloud1）：社群图片/头像所在的云存储环境。
// 默认云环境必须指向 cloud1，image 组件才能直接渲染 cloud:// fileID（后端临时链接转换失败时的兜底）；
// callContainer 与 uploadFile 各自显式指定 env，不受默认值影响。
const CLOUDBASE_UPLOAD_ENV = 'cloud1-d5gcgaukz8cb3f907';
const CLOUD_RUN_SERVICE = 'guayouji-server';
App({
  onLaunch: function (options) {
    this.globalData.version = '0.8.16';
    this.globalData.welcomeGate = welcome.createGate(options);
    // 初始化微信云能力：默认环境指向 cloud1（社群云存储）；callContainer 在各页面显式传云托管环境。
    if (typeof wx !== 'undefined' && wx.cloud && typeof wx.cloud.init === 'function') {
      try { wx.cloud.init({ env: CLOUDBASE_UPLOAD_ENV }); } catch (error) {}
    }
  },
  cloudRunEnv: function () { return CLOUD_RUN_ENV; },
  cloudRunService: function () { return CLOUD_RUN_SERVICE; },
  cloudbaseEnv: function () { return CLOUDBASE_UPLOAD_ENV; },
  // 字体大小三档（「我的-字体大小」设置，评审 P05①）：各页面根容器挂上返回的 class
  // （<view class="page {{fontClass}}">，onShow 里 setData({ fontClass: getApp().getFontClass() })），
  // app.wxss 里的 .fs-large / .fs-xlarge 规则即整页生效；normal 为默认档，无需额外规则。
  getFontClass: function () { return 'fs-' + store.getFontScale(); },
  globalData: {version: '0.8.1', welcomeGate: null}
});
