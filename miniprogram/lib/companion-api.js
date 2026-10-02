'use strict';

// Image generation is enabled through an explicit transport and remains
// independent of the text AI switch and isolated from demo accounts.
function createClient(options) {
  options = options || {};
  const enabled = options.enabled === true && typeof options.transport === 'function';
  let state = { status: 'idle', taskId: null, imageUrl: null };
  let revision = 0, pollFailures = 0;
  function blocked() { return !enabled || options.isDemo && options.isDemo(); }
  function snapshot() { return Object.assign({}, state); }
  function disable() { state = { status: 'disabled', taskId: null, imageUrl: null, message: '照片生成服务未启用' }; return snapshot(); }
  return {
    capability: function () { return { configured: enabled && !blocked(), uploadEnabled: enabled && !blocked() }; },
    state: snapshot,
    clear: function () { revision += 1; state = { status: 'idle', taskId: null, imageUrl: null }; },
    generate: async function (image, confirmed, requestId) {
      const current = ++revision; pollFailures = 0;
      if (blocked()) { state = { status: 'disabled', taskId: null, imageUrl: null, message: '照片已选，生成服务尚未配置' }; return snapshot(); }
      if (confirmed !== true) { state = { status: 'awaiting-confirmation', taskId: null, imageUrl: null }; return snapshot(); }
      state = { status: 'uploading', taskId: null, imageUrl: null };
      try {
        const upload = await options.transport('POST', '/api/companion/uploads', Object.assign({}, image, { confirmed: true }));
        if (current !== revision) return snapshot();
        if (blocked()) return disable();
        const job = await options.transport('POST', '/api/companion/generations', { resourceId: upload.resourceId, style: 'fruit-line-art', requestId: requestId });
        if (current !== revision) return snapshot();
        if (blocked()) return disable();
        if (!job || typeof job.taskId !== 'string' || !['queued', 'generating', 'succeeded', 'failed'].includes(job.status)) throw new Error('生成服务响应无效');
        state = { status: job.status === 'succeeded' ? 'generating' : job.status, taskId: job.taskId, imageUrl: null };
      } catch (error) { if (current === revision) state = { status: 'failed', taskId: null, imageUrl: null, message: error.message || '生成暂未完成，可重试或使用内置模板' }; }
      return snapshot();
    },
    poll: async function () {
      if (blocked()) return disable();
      if (!state.taskId || !['queued', 'generating'].includes(state.status)) return snapshot();
      const current = revision;
      try {
        const result = await options.transport('GET', '/api/companion/generations/' + encodeURIComponent(state.taskId));
        if (current !== revision) return snapshot();
        if (blocked()) return disable();
        if (!result || !['queued', 'generating', 'succeeded', 'failed'].includes(result.status) || result.status === 'succeeded' && !/^https:\/\//.test(result.imageUrl || '')) throw Object.assign(new Error('结果无效'), { retryable: false });
        pollFailures = 0;
        state = { status: result.status, taskId: state.taskId, imageUrl: result.status === 'succeeded' ? result.imageUrl : null };
      } catch (error) { if (current === revision) state = Object.assign({}, state, { status: error.retryable !== false && ++pollFailures <= 3 ? state.status : 'failed', message: error.message || '暂未取得生成结果，请稍后重试' }); }
      return snapshot();
    }
  };
}
module.exports = { createClient };
