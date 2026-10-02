'use strict';

function validLocation(point) {
  return !!point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
    && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180
    && point.coordinateSystem === 'gcj02';
}
function validOrigin(point) {
  return validLocation(point) && typeof point.name === 'string' && point.name.trim().length > 0
    && point.name.length <= 200 && typeof point.address === 'string' && point.address.length <= 500
    && ['catalog', 'user'].includes(point.source);
}
function distanceKm(a, b) {
  if (!validLocation(a) || !validLocation(b)) throw new Error('地点需要有效的 GCJ-02 坐标');
  const rad = Math.PI / 180;
  const dlat = (b.latitude - a.latitude) * rad, dlng = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dlng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
// Distance-based planning estimate only: never a road route or live traffic time.
function estimateLeg(a, b, profile) {
  const distance = distanceKm(a, b);
  if (profile.transport === 'public') throw new Error('公交需班次与换乘信息，当前暂不生成公交时间表；请选择步行、自驾或骑行。');
  const speed = profile.transport === 'walk' ? (profile.walking === 'easy' ? 3 : 4)
    : profile.transport === 'bike' ? 12 : profile.transport === 'drive' ? 25 : 0;
  if (!speed) throw new Error('交通方式不支持');
  const minutes = distance < 0.03 ? 0 : Math.ceil((distance * 1.4 / speed * 60 + (profile.transport === 'drive' ? 8 : 2)) / 5) * 5;
  return { minutes, cost: null, straightDistanceKm: Math.round(distance * 100) / 100, mode: 'distance-estimate', estimated: true };
}
function locationFailure(error) {
  const message = String(error && (error.errMsg || error.message) || '');
  if (/auth deny|auth denied|authorize|privacy|拒绝/i.test(message)) return { settings: true, message: '没有获得定位授权，原起点已保留。可去设置开启权限，或继续手动选点。' };
  if (/system permission denied|gps|location service|location switch|disabled|定位.*关闭/i.test(message)) return { settings: false, message: '系统定位可能未开启，请检查手机定位服务；也可继续手动选点，原起点不变。' };
  if (/timeout|time out/i.test(message)) return { settings: false, message: '定位等待超时，原起点已保留。请重试，或直接手动选点。' };
  if (/not support|not available|not declared|api permission|not in/i.test(message)) return { settings: false, message: '当前环境或小程序暂不能使用定位接口，请使用地图选点或已核实地点。' };
  return { settings: false, message: '暂时无法取得有效位置，原起点已保留。请使用地图选点或已核实地点。' };
}
module.exports = { validLocation, validOrigin, distanceKm, estimateLeg, locationFailure };
