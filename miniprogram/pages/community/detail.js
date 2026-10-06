'use strict';
// 动态详情页（10.5 新增）：点列表卡片进入，朋友圈式——大图可预览 + 点赞 + 评论区 + 底部评论输入栏。
const store = require('../../lib/store');
const i18n = require('../../lib/i18n');
const communityApi = require('../../lib/community');

function callApi(method, path, body) { return communityApi.callApi(method, path, body); }

Page({
  data: {
    id: '', post: null, image: '', avatar: '', comments: [],
    loading: true, error: '', liked: false, likes: 0,
    replyTo: '', commentValue: '', sending: false, L: {}
  },
  onLoad: function (options) {
    this.setData({
      L: i18n.labels(['loading', 'network_error', 'community_detail_title', 'community_text_ph', 'community_send', 'community_reply_prefix', 'community_post_gone'])
    });
    const id = options && typeof options.id === 'string' ? options.id : '';
    this.setData({ id: id });
    if (!id) { this.setData({ loading: false, error: i18n.t('community_post_gone') }); return; }
    i18n.applyNav('community_detail_title');
    this.loadDetail();
  },
  onShow: function () {
    this.setData({ fontClass: typeof getApp === 'function' && getApp() ? getApp().getFontClass() : 'fs-normal' });
  },
  loadDetail: function () {
    if (!communityApi.cloudAvailable()) { this.setData({ loading: false, error: i18n.t('community_offline') }); return; }
    this.setData({ loading: true, error: '' });
    callApi('GET', '/api/community/detail?id=' + encodeURIComponent(this.data.id)).then(res => {
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
      if (res && typeof res.likes === 'number') this.setData({ likes: res.likes, liked: !!res.liked });
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
      this.loadDetail();
    }).catch(error => {
      this.setData({ sending: false });
      wx.showToast({ title: (error && error.message) || i18n.t('network_error'), icon: 'none' });
    });
  }
});
