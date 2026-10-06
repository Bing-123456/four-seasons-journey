'use strict';
// 游戏板块背景图（农谚问答 / 农事挑战 / 文化连连看，1.92:1 横版）——云端加载地址。
// 上传位置：微信云存储（开发者工具 → 云开发控制台 → 存储 → 新建目录 game-art/）。
// 建议云路径：game-art/quiz.jpg、game-art/challenge.jpg、game-art/match.jpg。
// 取值格式：填云存储 fileID（cloud:// 开头的完整串，上传后由控制台给出）。
// <image> 原生支持 cloud:// fileID，无需域名白名单、不过期；不要填 getTempFileURL 的临时 HTTPS 链接。
// 留空时不渲染背景图，卡片回退到纯色 #EDE6D3（见 learn.wxss .game-entry）。
module.exports = {
  // 农谚问答背景图：已处理为 ../game-art-upload/quiz.jpg，上传云存储后把 fileID 填到下面
  quiz: 'cloud://prod-d8gw4a7vm69f14375.7072-prod-d8gw4a7vm69f14375-1499093335/game-art/quiz.jpg.jpg',

  // 农事挑战背景图：已处理为 ../game-art-upload/challenge.jpg，上传云存储后把 fileID 填到下面
  challenge: 'cloud://prod-d8gw4a7vm69f14375.7072-prod-d8gw4a7vm69f14375-1499093335/game-art/challenge.jpg.jpg',

  // 文化连连看背景图：已处理为 ../game-art-upload/match.jpg，上传云存储后把 fileID 填到下面
  match: 'cloud://prod-d8gw4a7vm69f14375.7072-prod-d8gw4a7vm69f14375-1499093335/game-art/match.jpg.jpg'
};
