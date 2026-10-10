'use strict';
// 详情页入口（评审 P24③）：空态「选择起点，规划文化行程」按钮与右下角「＋」改为打开
// 分步向导（定制文化行程，packageTrip 分包页）；其余 editProfile 入口（修改条件、调整偏好）
// 保持跳资料页。
const controller = require('../lib/route-controller')({ detail: true });
controller.openWizard = function () { wx.navigateTo({ url: '/packageTrip/pages/trip-wizard/trip-wizard' }); };
Page(controller);
