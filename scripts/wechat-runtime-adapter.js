'use strict';

/*
 * Compatibility bridge for miniprogram-automator 0.12.1 + SDK 3.17.3.
 * App.evaluate works in the affected DevTools runtime while Page.data and
 * Element commands may never resolve. This uses the official App.evaluate
 * entry point and existing Page instances; the business app needs no hooks.
 * tap/input below invoke an explicitly named Page event handler. They are
 * controller actions with rendered-node evidence, NOT physical UI gestures.
 */

function runtimeOperation(route, operation, payload) {
  // This function is serialized by App.evaluate. Keep all runtime dependencies
  // inside the function and use only the normal Mini Program runtime globals.
  const stack = getCurrentPages();
  let page = null;
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (!route || stack[index].route === route) { page = stack[index]; break; }
  }
  if (!page) throw new Error('Runtime page is no longer in the stack: ' + route);
  // App.evaluate serializes its result across the bridge. JSON.stringify on the
  // SDK's proxied Page.data can itself trigger a runtime instanceof error.
  function copy(value) { return value === undefined ? null : value; }
  if (operation === 'data') {
    let value = page.data;
    const keys = payload.path ? payload.path.replace(/\[(\d+)\]/g, '.$1').split('.') : [];
    for (let index = 0; index < keys.length; index += 1) {
      if (value === null || value === undefined || !Object.prototype.hasOwnProperty.call(value, keys[index])) return null;
      value = value[keys[index]];
    }
    return copy(value);
  }
  if (operation === 'setData') {
    page.setData(payload.patch);
    // Page.data is updated synchronously. Callers can waitFor() before capturing
    // the separately scheduled view rendering.
    return null;
  }
  if (operation === 'callMethod') {
    if (typeof page[payload.method] !== 'function') throw new Error('Page handler does not exist: ' + payload.method);
    const result = page[payload.method].apply(page, payload.args);
    return result && typeof result.then === 'function' ? result.then(copy) : copy(result);
  }
  if (operation === 'query') {
    return new Promise(function (resolve, reject) {
      let completed = false;
      const timer = setTimeout(function () { if (!completed) { completed = true; reject(new Error('Selector query timed out: ' + payload.selector)); } }, 4000);
      try {
        wx.createSelectorQuery().in(page).select(payload.selector).fields({ id: true, dataset: true, rect: true, size: true, properties: ['value', 'disabled'] }).exec(function (results) {
          if (completed) return;
          completed = true; clearTimeout(timer);
          const node = results && results[0];
          resolve({ exists: !!node, selector: payload.selector, route: page.route, node: node ? copy(node) : null, evidence: 'wx.createSelectorQuery' });
        });
      } catch (error) { completed = true; clearTimeout(timer); reject(error); }
    });
  }
  throw new Error('Unknown runtime operation: ' + operation);
}

function validateDataPath(path) {
  if (path === undefined || path === null || path === '') return '';
  if (typeof path !== 'string' || !/^[A-Za-z0-9_$]+(?:\[\d+\]|\.[A-Za-z0-9_$]+)*$/.test(path)) throw new TypeError('data(path) requires a simple dot/bracket property path');
  return path;
}

function wrapPage(mp, page, options) {
  if (!mp || typeof mp.evaluate !== 'function') throw new TypeError('wrapPage requires a connected MiniProgram with evaluate()');
  if (!page || typeof page.path !== 'string' || !page.path) throw new TypeError('wrapPage requires the Page returned by currentPage/navigation');
  const route = page.path.replace(/^\/+/, '').split('?')[0];
  const timeout = options && Number.isInteger(options.timeout) && options.timeout > 0 ? options.timeout : 12000;
  const handlers = options && options.handlers || {};
  async function evaluate(operation, payload) {
    let timer;
    try {
      return await Promise.race([
        mp.evaluate(runtimeOperation, route, operation, payload),
        new Promise(function (resolve, reject) { timer = setTimeout(function () { reject(new Error('App.evaluate timed out for ' + route + ' / ' + operation)); }, timeout); })
      ]);
    } finally { clearTimeout(timer); }
  }
  async function nodeFor(selector) {
    if (typeof selector !== 'string' || !selector.trim() || selector.length > 500) throw new TypeError('selector must be a nonempty string');
    const evidence = await evaluate('query', { selector });
    if (!evidence || !evidence.exists) throw new Error('Rendered node was not found: ' + selector + ' on ' + route);
    return evidence;
  }
  async function invoke(method, args) {
    if (typeof method !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(method) || ['constructor', '__proto__', 'setData'].includes(method)) throw new TypeError('callMethod requires a named Page handler');
    return evaluate('callMethod', { method, args });
  }
  const wrapped = {
    path: route,
    queryParams: page.query || {},
    adapter: 'official-app-evaluate',
    data: function (path) { return evaluate('data', { path: validateDataPath(path) }); },
    setData: function (patch) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return Promise.reject(new TypeError('setData requires an object'));
      return evaluate('setData', { patch });
    },
    callMethod: function (method) { return invoke(method, Array.prototype.slice.call(arguments, 1)); },
    waitFor: function (milliseconds) {
      if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 60000) return Promise.reject(new TypeError('waitFor requires 0–60000 milliseconds'));
      return new Promise(resolve => setTimeout(resolve, milliseconds));
    },
    query: function (selector) {
      if (typeof selector !== 'string' || !selector.trim() || selector.length > 500) return Promise.reject(new TypeError('selector must be a nonempty string'));
      return evaluate('query', { selector });
    },
    tap: async function (selector, method) {
      const handler = method || handlers.tap && handlers.tap[selector];
      if (!handler) throw new Error('tap(selector, method) needs the bound Page handler; this adapter does not synthesize physical taps');
      const evidence = await nodeFor(selector);
      if (evidence.node.disabled) throw new Error('Rendered control is disabled: ' + selector);
      const target = { id: evidence.node.id || '', dataset: evidence.node.dataset || {} };
      const result = await invoke(handler, [{ type: 'tap', currentTarget: target, target, detail: {} }]);
      return { action: 'page-handler', physicalGesture: false, handler, evidence, result };
    },
    input: async function (selector, value, method) {
      const handler = method || handlers.input && handlers.input[selector];
      if (!handler) throw new Error('input(selector, value, method) needs the bound Page input handler');
      const evidence = await nodeFor(selector);
      if (evidence.node.disabled) throw new Error('Rendered control is disabled: ' + selector);
      const target = { id: evidence.node.id || '', dataset: evidence.node.dataset || {} };
      const result = await invoke(handler, [{ type: 'input', currentTarget: target, target, detail: { value: String(value) } }]);
      return { action: 'page-handler', physicalGesture: false, handler, evidence, result };
    }
  };
  return wrapped;
}

module.exports = { wrapPage };
