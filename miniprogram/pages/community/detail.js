'use strict';
// 动态详情页（10.5 新增）：点列表卡片进入，朋友圈式——大图可预览 + 点赞 + 评论区 + 底部评论输入栏。
const store = require('../../lib/store');
const i18n = require('../../lib/i18n');
const communityApi = require('../../lib/community');

function callApi(method, path, body) { return communityApi.callApi(method, path, body); }

Page({
  data: {
    id: '', post: null, image: '', avatar: '', comments: [],
    loading: true, error: '', liked: false, likes: 0, myNickname: '',
    replyTo: '', commentValue: '', sending: false, L: {}
  },
  onLoad: function (options) {
    this.setData({
      L: i18n.labels(['loading', 'network_error', 'community_detail_title', 'community_text_ph', 'community_send', 'community_reply_prefix', 'community_post_gone', 'community_delete_hint', 'community_delete_comment_title', 'community_delete_comment_msg', 'community_delete_post_title', 'community_delete_post_msg', 'community_delete', 'community_cancel', 'community_deleted', 'community_only_self'])
    });
    const id = options && typeof options.id === 'string' ? options.id : '';
    this.setData({ id: id });
    if (!id) { this.setData({ loading: false, error: i18n.t('community_post_gone') }); return; }
    i18n.applyNav('community_detail_title');
    this.loadDetail();
  },
  onShow: function () {
    const me = store.getIdentity() || {};
    this.setData({ fontClass: typeof getApp === 'function' && getApp() ? getApp().getFontClass() : 'fs-normal', myNickname: me.nickname || i18n.t('traveller') });
  },
  loadDetail: function () {
    if (!communityApi.cloudAvailable()) { this.setData({ loading: false, error: i18n.t('community_offline') }); return; }
    this.setData({ loading: true, error: '' });
    return callApi('GET', '/api/community/detail?id=' + encodeURIComponent(this.data.id)).then(res => {
      const post = (res && res.post) || null;
      if (!post) { this.setData({ loading: false, error: i18n.t('community_post_gone') }); return; }
      post.timeText = communityApi.formatRelativeTime(post.createdAt);
      this.setData({
        loading: false, post: post,
        image: post.image || '', avatar: post.avatar || '',
        likes: post.likes || 0, liked: !!post.liked,
        comments: (post.comments || []).map(c => ({
          nickname: c.nickname, text: c.text, replyTo: c.replyTo || '',
          timeText: communityApi.formatRelativeTime(c.createdAt)
        }))
      });
    }).catch(error => {
      this.setData({ loading: false, error: (error && error.message) || i18n.t('network_error') });
    });
  },
  previewImage: function () {
    if (this.data.image && typeof wx !== 'undefined' && wx.previewImage) {
      wx.previewImage({ current: this.data.image, urls: [this.data.image] });
    }
  },
  toggleLike: function () {
    if (!communityApi.cloudAvailable()) return;
    callApi('POST', '/api/community/like', { id: this.data.id }).then(res => {
      if (res && typeof res.likes === 'number') {
        this.setData({ likes: res.likes, liked: !!res.liked });
        // 记住这条帖子点赞状态变化，返回列表时同步，但整页不刷新（保留滚动位置）。
        const app = (typeof getApp === 'function') ? getApp() : null;
        if (app) app.communityDirty = { id: this.data.id, liked: !!res.liked, likes: res.likes };
      }
    }).catch(() => wx.showToast({ title: i18n.t('network_error'), icon: 'none' }));
  },
  tapReply: function (event) {
    this.setData({ replyTo: event.currentTarget.dataset.nickname || '' });
  },
  cancelReply: function () {
    this.setData({ replyTo: '' });
  },
  onCommentInput: function (event) {
    this.setData({ commentValue: event.detail.value });
  },
  sendComment: function () {
    const text = (this.data.commentValue || '').trim();
    if (!text || this.data.sending) return;
    if (!communityApi.cloudAvailable()) return;
    const me = store.getIdentity() || {};
    this.setData({ sending: true });
    callApi('POST', '/api/community/comment', {
      id: this.data.id, text: text,
      nickname: me.nickname || i18n.t('traveller'),
      replyTo: this.data.replyTo
    }).then(() => {
      this.setData({ commentValue: '', replyTo: '', sending: false });
      return this.loadDetail();
    }).then(() => {
      // 评论刷新后，把最新评论列表带回去同步给列表页（同样不整页刷新）。
      const app = (typeof getApp === 'function') ? getApp() : null;
      if (app) app.communityDirty = { id: this.data.id, comments: this.data.comments };
    }).catch(error => {
      this.setData({ sending: false });
      wx.showToast({ title: (error && error.message) || i18n.t('network_error'), icon: 'none' });
    });
  },
  // 长按删除评论：仅本人（昵称匹配，且非默认名「旅人」）可删；确认后刷新详情。
  onLongPressComment: function (event) {
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
        if (!communityApi.cloudAvailable()) return;
        callApi('POST', '/api/community/delete-comment', { id: this.data.id, index: index, nickname: this.data.myNickname })
          .then(() => {
            wx.showToast({ title: i18n.t('community_deleted'), icon: 'none' });
            return this.loadDetail();
          })
          .then(() => {
            const app = (typeof getApp === 'function') ? getApp() : null;
            if (app) app.communityDirty = { id: this.data.id, comments: this.data.comments };
          })
          .catch(error => wx.showToast({ title: (error && error.message) || i18n.t('network_error'), icon: 'none' }));
      }
    });
  },
  // 长按删除自己的动态：仅 post.mine 为真可删；确认后返回列表。
  onLongPressPost: function () {
    if (!this.data.post || !this.data.post.mine) {
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
        if (!communityApi.cloudAvailable()) return;
        callApi('POST', '/api/community/delete-post', { id: this.data.id })
          .then(() => {
            wx.showToast({ title: i18n.t('community_deleted'), icon: 'none' });
            // 告诉列表页这条已删除，返回时直接移除（不整页刷新）。
            const app = (typeof getApp === 'function') ? getApp() : null;
            if (app) app.communityDirty = { id: this.data.id, deleted: true };
            setTimeout(function () { wx.navigateBack(); }, 400);
          })
          .catch(error => wx.showToast({ title: (error && error.message) || i18n.t('network_error'), icon: 'none' }));
      }
    });
  }
});
