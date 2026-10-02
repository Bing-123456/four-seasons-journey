'use strict';
// This gate belongs to the App instance, not a Page, so tab switches/reLaunch
// cannot accidentally replay the first-entry animation.
function createGate(options) {
  const launch = options || {};
  const shared = [1007, 1008, 1044, 1154, 1155].includes(launch.scene);
  let eligible = !shared && (!launch.path || launch.path.replace(/^\//, '') === 'pages/index/index');
  let consumed = false;
  return { consume: function (enabled) { if (consumed) return false; consumed = true; return eligible && enabled !== false; } };
}
module.exports = { createGate };
