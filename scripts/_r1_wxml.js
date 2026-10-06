'use strict';
// 第1 轮 · 发现页改造：全屏海报 + 58px 把手 + 上滑抽屉（四时/游戏/行程/快讯）
// 依据：mockups/final-design-3pages.html（视觉规格 / 跳转关系总表 / 状态与边界）
// 只改 pages/index/index.wxml，保留原三张轮播图数据与自动轮播设置。
const fs = require('fs');
const path = require('path');
const P = path.resolve(__dirname, '../miniprogram/pages/index/index.wxml');

const HEAD = fs.readFileSync(P, 'utf8').split('\n').slice(0, 20).join('\n'); // 至 home-heading结束
const TAIL_START = fs.readFileSync(P, 'utf8').split('\n').slice(33).join('\n');// 自 </view>(home-screen) 起

const BLOCK = `
  <!-- 全屏海报：底层 bg（本地小图、仅铺满防黑边）+ 上层清晰主图（云存储 fileID） -->
  <view id="farming-forecast" class="poster-region">
    <swiper class="poster-swiper" current="{{featureIndex}}" bindchange="changeFeature" autoplay="{{true}}" interval="5000" circular="{{forecastPosters.length > 1}}" duration="320">
      <swiper-item wx:for="{{forecastPosters}}" wx:key="id">
        <view class="poster-card {{featureIndex === index ? 'is-current' : ''}}" data-id="{{item.id}}" bindtap="openBooking" role="button" aria-label="{{item.title}} · {{visualCopy.eventAction}}">
          <image class="poster-image poster-image-bg" src="{{item.imageBg || item.image}}" mode="aspectFill" lazy-load="true" aria-hidden="true"/>
          <image class="poster-image poster-image-main" src="{{item.image}}" mode="aspectFit" lazy-load="true" binderror="onPosterError" data-idx="{{index}}" aria-label="{{item.title}}"/>
          <view wx:if="{{item.bookable}}" class="poster-cover-copy"><view class="poster-cover-title">{{item.title}}</view><view>{{item.place}}</view><view>{{item.date}}</view></view>
          <view wx:if="{{featureIndex === index}}" class="poster-dots"><view wx:for="{{forecastPosters}}" wx:key="id" wx:for-item="dot" wx:for-index="dotIdx" class="poster-dot {{dotIdx === index ? 'active' : ''}}"/></view>
        </view>
      </swiper-item>
    </swiper>
  </view>

  <!-- 底部把手（58px）：点按或上滑展开抽屉 -->
  <view class="poster-handle {{drawerOpen ? 'is-open' : ''}}" bindtap="toggleDrawer" role="button" aria-label="{{L.drawer_handle}}" aria-expanded="{{drawerOpen}}">
    <view class="handle-grip"/>
    <view class="handle-label">{{L.drawer_handle}}</view>
    <view class="handle-arrow {{drawerOpen ? 'is-open' : ''}}">›</view>
  </view>

  <!-- 抽屉：四时 / 游戏 / 行程 / 快讯 四段，顺序固定 -->
  <view class="drawer {{drawerOpen ? 'is-open' : ''}}" catchtouchmove="noop">
    <view class="drawer-panel">
      <view class="drawer-grip-area" bindtap="toggleDrawer"><view class="handle-grip"/></view>

      <!-- 段一 · 四时 -->
      <view class="drawer-row" data-seg="season" bindtap="openDrawerSeg" role="button">
        <view class="drawer-row-text">
          <view class="drawer-tag">{{L.drawer_seg_season}}</view>
          <view class="drawer-title">{{drawer.season.title}}</view>
          <view class="drawer-sub">{{drawer.season.sub}}</view>
        </view>
        <view class="drawer-arrow">›</view>
      </view>

      <!-- 段二 · 游戏 -->
      <view class="drawer-row" data-seg="game" bindtap="openDrawerSeg" role="button">
        <view class="drawer-row-text">
          <view class="drawer-tag">{{L.drawer_seg_game}}</view>
          <view class="drawer-title">{{L.drawer_game_title}}</view>
          <view class="drawer-sub">{{drawer.game.sub}}</view>
          <view class="drawer-games">
            <view wx:for="{{drawer.game.slots}}" wx:key="key" class="drawer-game" data-game="{{item.key}}" catchtap="openGame" role="button">
              <view class="drawer-game-no">{{item.no}}</view>
              <view class="drawer-game-name">{{item.name}}</view>
              <view class="drawer-game-state">{{item.state}}</view>
            </view>
          </view>
        </view>
        <view class="drawer-arrow">›</view>
      </view>

      <!-- 段三 · 行程 -->
      <view class="drawer-row" data-seg="route" bindtap="openDrawerSeg" role="button">
        <view class="drawer-row-text">
          <view class="drawer-tag">{{L.drawer_seg_route}}</view>
          <view class="drawer-title">{{drawer.route.title}}</view>
          <view class="drawer-sub">{{drawer.route.sub}}</view>
        </view>
        <view class="drawer-arrow">›</view>
      </view>

      <!-- 段四 · 快讯（本轮先不跳，待快讯页建成后接入） -->
      <view class="drawer-row drawer-row-static" data-seg="news">
        <view class="drawer-row-text">
          <view class="drawer-tag">{{L.drawer_seg_news}}</view>
          <view class="drawer-title">{{drawer.news.title}}</view>
          <view class="drawer-sub">{{drawer.news.sub}}</view>
        </view>
        <view class="drawer-arrow is-dim">›</view>
      </view>
    </view>
  </view>
`;

fs.writeFileSync(P, HEAD + BLOCK + TAIL, 'utf8');
const out = fs.readFileSync(P, 'utf8');
console.log('wxml 写入完成，长度', out.length);
console.log('包含 swiper 自动轮播:', /autoplay="{{true}}" interval="5000"/.test(out));
console.log('包含三层图bg+main:', /poster-image-bg/.test(out) && /poster-image-main/.test(out));
console.log('四段顺序:', (out.match(/drawer-tag/g) || []).length, '段');