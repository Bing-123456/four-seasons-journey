'use strict';
// 社群列表页：仿朋友圈共同动态流，所有水果共用同一个 feed（不按水果分圈）。
// 数据走云托管 guayouji-server 的 /api/community/* 接口（后端 v35+），
// 帖子图片/头像是云存储 fileID，image 组件可直接渲染 cloud:// 协议。
const store = require('../../lib/store');
const i18n = require('../../lib/i18n');
const cloudImg = require('../../lib/cloud-images');
const communityApi = require('../../lib/community');

function cloudAvailable() { return communityApi.cloudAvailable(); }

function callApi(method, path, body) { return communityApi.callApi(method, path, body); }

function formatRelativeTime(ts) { return communityApi.formatRelativeTime(ts); }

Page({
  data: { posts: [], loading: true, error: '', myNickname: '', L: {}, cloudOrchard: cloudImg.img('illustrations/orchard-garden') },
  onLoad: function () {
    i18n.applyNav('community_title');
    this.setData({ L: i18n.labels(['loading', 'community_empty', 'community_post_title', 'network_error', 'community_offline', 'community_delete_hint', 'community_delete_comment_title', 'community_delete_comment_msg', 'community_delete_post_title', 'community_delete_post_msg', 'community_delete', 'community_cancel', 'community_deleted', 'community_only_self']) });
  },
  onShow: function () {
    const me = store.getIdentity() || {};
    this.setData({ fontClass: typeof getApp === 'function' && getApp() ? getApp().getFontClass() : 'fs-normal', myNickname: me.nickname || i18n.t('traveller') });
    // 从详情页返回时，若那条帖子在详情页被点赞/评论/删除，只更新对应那一条（不整页刷新、不重置滚动）；
    // 纯查看返回则连更新都不做，完全保留原位。
    const app = (typeof getApp === 'function') ? getApp() : null;
    const dirty = app && app.communityDirty;
    if (dirty && dirty.id) {
      app.communityDirty = null;
      this._enteredDetail = false;
      const posts = (this.data.posts || []).map(function (p) {
        if (p._id !== dirty.id) return p;
        if (dirty.deleted) return null;
        const next = Object.assign({}, p);
        if (typeof dirty.liked === 'boolean') next.liked = dirty.liked;
        if (typeof dirty.likes === 'number') next.likes = dirty.likes;
        if (Array.isArray(dirty.comments)) next.comments = dirty.comments;
        return next;
      }).filter(Boolean);
      this.setData({ posts: posts });
      return;
    }
    // 纯查看进详情再返回：保留列表与滚动位置，不重新拉取。
    if (this._enteredDetail) { this._enteredDetail = false; return; }
    this.loadPosts();
  },
  // 未连接云托管（测试/开发环境）时优雅降级，不报错。
  loadPosts: function () {
    if (!cloudAvailable()) { this.setData({ loading: false, error: i18n.t('community_offline') }); return; }
    this.setData({ loading: true, error: '' });
    callApi('GET', '/api/community/list').then(result => {
      const posts = (result && result.posts) || [];
      posts.forEach(p => { p.timeText = formatRelativeTime(p.createdAt); });
      this.setData({ posts: posts, loading: false });
    }).catch(error => {
      // 显示服务端具体错误（便于评审排查：数据库/权限问题会带明细，不再是笼统「网络异常」）。
      const message = (error && error.message) || i18n.t('network_error');
      this.setData({ loading: false, error: message });
    });
  },
  // 点赞（朋友圈式）：同一用户再点一次是取消赞；likes/liked 以后端真实数据为准。
  toggleLike: function (event) {
    const id = event.currentTarget.dataset.id;
    if (!cloudAvailable()) return;
    callApi('POST', '/api/community/like', { id: id }).then(res => {
      const posts = this.data.posts.map(p => {
        if (p._id !== id) return p;
        return Object.assign({}, p, {
          liked: !!(res && res.liked),
          likes: res && typeof res.likes === 'number' ? res.likes : p.likes
        });
      });
      this.setData({ posts: posts });
    }).catch(() => wx.showToast({ title: i18n.t('network_error'), icon: 'none' }));
  },
  // 评论：支持回复某人（朋友圈式）。点评论区里的昵称即带出回复目标；confirm 后真实入库并刷新。
  addComment: function (event) {
    const id = event.currentTarget.dataset.id;
    const replyTo = event.currentTarget.dataset.replyTo || '';
    if (typeof wx === 'undefined' || !wx.showModal) return;
    wx.showModal({
      title: replyTo ? i18n.t('community_reply_prefix') + ' ' + replyTo : i18n.t('community_comment_title'),
      editable: true, placeholderText: i18n.t('community_comment_ph'),
      success: res => {
        if (!res.confirm || !res.content) return;
        // 评论带上「我的资料」页保存的昵称（store.getIdentity().nickname 与 account 页同源）；
        // 未填昵称时与发帖一致回退「旅人」，不再显示「果友」。
        const me = store.getIdentity() || {};
        callApi('POST', '/api/community/comment', { id: id, text: res.content, nickname: me.nickname || i18n.t('traveller'), replyTo: replyTo })
          .then(() => this.loadPosts())
          .catch(() => wx.showToast({ title: i18n.t('network_error'), icon: 'none' }));
      }
    });
  },
  // 点帖子卡片进详情页（大图 + 朋友圈式评论区）；点赞/评论按钮用 catchtap 阻止冒泡。
  goDetail: function (event) {
    const id = event.currentTarget.dataset.id;
    if (id) { this._enteredDetail = true; wx.navigateTo({ url: '/pages/community/detail?id=' + id }); }
  },
  goPost: function () { wx.navigateTo({ url: '/pages/community/post' }); },
  // 长按删除评论：仅本人（昵称匹配，且非默认名「旅人」）可删；确认后真实删除并刷新。
  onLongPressComment: function (event) {
    const id = event.currentTarget.dataset.id;
    const index = event.currentTarget.dataset.index;
    const nickname = event.currentTarget.dataset.nickname || '';
    if (this.data.myNickname === i18n.t('traveller') || nickname !== this.data.myNickname) {
      wx.showToast({ title: i18n.t('community_only_self'), icon: 'none' });
      return;
    }
    if (typeof wx === 'undefined' || !wx.showModal) return;
    wx.showModal({
      title: i18n.t('community_delete_comment_title'),
      content: i18n.t('community_delete_comment_msg'),
      confirmText: i18n.t('community_delete'),
      cancelText: i18n.t('community_cancel'),
      success: res => {
        if (!res.confirm) return;
        if (!cloudAvailable()) return;
        callApi('POST', '/api/community/delete-comment', { id: id, index: index, nickname: this.data.myNickname })
          .then(() => { wx.showToast({ title: i18n.t('community_deleted'), icon: 'none' }); this.loadPosts(); })
          .catch(error => wx.showToast({ title: (error && error.message) || i18n.t('network_error'), icon: 'none' }));
      }
    });
  },
  // 长按删除自己的动态：仅 mine 为真可删；确认后从列表移除。
  onLongPressPost: function (event) {
    const id = event.currentTarget.dataset.id;
    const post = (this.data.posts || []).find(p => p._id === id);
    if (!post || !post.mine) {
      wx.showToast({ title: i18n.t('community_only_self'), icon: 'none' });
      return;
    }
    if (typeof wx === 'undefined' || !wx.showModal) return;
    wx.showModal({
      title: i18n.t('community_delete_post_title'),
      content: i18n.t('community_delete_post_msg'),
      confirmText: i18n.t('community_delete'),
      cancelText: i18n.t('community_cancel'),
      success: res => {
        if (!res.confirm) return;
        if (!cloudAvailable()) return;
        callApi('POST', '/api/community/delete-post', { id: id })
          .then(() => {
            const posts = (this.data.posts || []).filter(p => p._id !== id);
            this.setData({ posts: posts });
            wx.showToast({ title: i18n.t('community_deleted'), icon: 'none' });
          })
          .catch(error => wx.showToast({ title: (error && error.message) || i18n.t('network_error'), icon: 'none' }));
      }
    });
  }
});
