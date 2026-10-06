'use strict';

// 主包图片云存储配置（2026-10-06，为解决主包超 2MB 硬线）
//
// 背景：主包体积 3031KB > 微信硬线 2048KB，其中 assets 占 930KB。
// 实测「重新压缩 jpg」不可行（74 张图质量 82 压完反而从 800.9KB 涨到 891KB，
// 因原图已压得很狠），故改为把这 12 张大图移出主包、改走云存储加载。
// 移走可省约 631KB，主包降至约 2.4MB；再配合把少量页面挪进分包即可过硬线。
//
// 用法（与 lib/game-art.js 相同的既有机制）：
//   1. 开发者工具 → 云开发控制台 → 存储 → 新建目录 assets/
//   2. 把 miniprogram/assets/ 下对应图片上传到该目录
//   3. 把控制台给出的 cloud:// fileID 填到下方，键名保持不变
// `<image>` 原生支持 cloud:// fileID，无需域名白名单、不过期；
// 不要填 getTempFileURL 的临时 HTTPS 链接（会过期）。
//
// 键名 = 图片相对 assets 的路径去掉扩展名，便于对照上传。
// 留空（''）时回退到本地路径 '/assets/xxx.jpg'，
// 所以即使云存储尚未配置，页面也不会出现空白图。

// 云存储 fileID 配置区——上传后把对应值填进来即可生效。
const CLOUD = {
  'illustrations/orchard-garden-banner': 'cloud://cloud1-d5gcgaukz8cb3f907.636c-cloud1-d5gcgaukz8cb3f907-1499093335/assets/orchard-garden-banner.jpg',
  'illustrations/home-carousel/activity-plum': 'cloud://cloud1-d5gcgaukz8cb3f907.636c-cloud1-d5gcgaukz8cb3f907-1499093335/assets/activity-plum.jpg',
  'illustrations/home-carousel/activity-loquat': 'cloud://cloud1-d5gcgaukz8cb3f907.636c-cloud1-d5gcgaukz8cb3f907-1499093335/assets/activity-loquat.jpg',
  'illustrations/home-carousel/activity-mulberry': 'cloud://cloud1-d5gcgaukz8cb3f907.636c-cloud1-d5gcgaukz8cb3f907-1499093335/assets/activity-mulberry.jpg',
  'dahecun-foundations-real': 'cloud://cloud1-d5gcgaukz8cb3f907.636c-cloud1-d5gcgaukz8cb3f907-1499093335/assets/dahecun-foundations-real.jpg',
  'illustrations/farmer-story-care': 'cloud://cloud1-d5gcgaukz8cb3f907.636c-cloud1-d5gcgaukz8cb3f907-1499093335/assets/farmer-story-care.jpg',
  'illustrations/farmer-story-scene': 'cloud://cloud1-d5gcgaukz8cb3f907.636c-cloud1-d5gcgaukz8cb3f907-1499093335/assets/farmer-story-scene.jpg',
  'doubanjiang-ref': 'cloud://cloud1-d5gcgaukz8cb3f907.636c-cloud1-d5gcgaukz8cb3f907-1499093335/assets/doubanjiang-ref.jpg',
  'henan-museum-real': 'cloud://cloud1-d5gcgaukz8cb3f907.636c-cloud1-d5gcgaukz8cb3f907-1499093335/assets/henan-museum-real.jpg',
  'illustrations/orchard-garden': 'cloud://cloud1-d5gcgaukz8cb3f907.636c-cloud1-d5gcgaukz8cb3f907-1499093335/assets/orchard-garden.jpg',
  'fruit-studio-illustration': 'cloud://cloud1-d5gcgaukz8cb3f907.636c-cloud1-d5gcgaukz8cb3f907-1499093335/assets/fruit-studio-illustration.jpg',
  'illustrations/loquat-still-life': 'cloud://cloud1-d5gcgaukz8cb3f907.636c-cloud1-d5gcgaukz8cb3f907-1499093335/assets/loquat-still-life.jpg'
};

// 这些键对应的图片仍需留在主包（小体积、需同步渲染或被 CSS 引用）。
const LOCAL_ONLY = {
  'illustrations/orchard-garden-banner-bg': true
};

// 图片绝对路径（云优先，云未配置时回退本地）。
function img(key) {
  const cloud = CLOUD[key];
  if (cloud) return cloud;
  return '/assets/' + key + '.jpg';
}

// 同一张图的背景版本（部分卡片 image 与 imageBg 共用一张图）。
function imgBg(key) {
  const cloud = CLOUD[key];
  if (cloud) return cloud;
  return LOCAL_ONLY[key] ? '/assets/' + key + '.jpg' : img(key);
}

module.exports = { CLOUD, img, imgBg };