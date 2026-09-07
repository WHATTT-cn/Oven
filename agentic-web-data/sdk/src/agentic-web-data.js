/**
 * AgenticWebData SDK
 * 前端与 Agent 服务端之间的桥:管理共享内存、脱敏、请求、广播变更。
 * 不含大模型,纯客户端代码。UMD 风格挂全局 window.AgenticWebData。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();          // CommonJS / Node
  } else {
    root.AgenticWebData = factory();     // 浏览器全局
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class AgenticWebData {
    /**
     * @param {object} opts
     * @param {string} opts.endpoint  Agent 服务端 /refresh 地址
     * @param {string} opts.appKey    鉴权 key(经 X-App-Key 头传递)
     * @param {(rows: object[]) => void} [opts.onChange] 数据变更回调(单向广播)
     * @param {number} [opts.timeout] 请求超时(ms),默认 30000
     */
    constructor({ endpoint, appKey, onChange, timeout = 30000 } = {}) {
      if (!endpoint) throw new Error('AgenticWebData: endpoint 必填');
      this._rows = [];
      this._endpoint = endpoint;
      this._appKey = appKey;
      this._onChange = onChange;
      this._timeout = timeout;
      this._timer = null;
    }

    /**
     * 传页面快照 → 请求 Agent → 覆盖共享内存 → 广播
     * @param {string} outerHTML
     * @returns {Promise<object[]>} rows
     */
    async refresh(outerHTML) {
      const safeHTML = this._sanitize(outerHTML);   // ① 脱敏:剥离内联脚本(含密钥)
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), this._timeout);
      try {
        const res = await fetch(this._endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-App-Key': this._appKey,
          },
          body: JSON.stringify({ outerHTML: safeHTML }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Agent 返回 ${res.status}`);
        const data = await res.json();
        const rows = Array.isArray(data.rows) ? data.rows : [];
        this._rows = rows;              // ② 刷新共享内存
        if (typeof this._onChange === 'function') {
          this._onChange(this._rows);   // ③ 单向广播
        }
        return this._rows;
      } finally {
        clearTimeout(t);
      }
    }

    /** 只读访问共享内存 */
    getRows() {
      return this._rows;
    }

    /**
     * 可选:定时刷新
     * @param {number} ms 间隔毫秒
     * @param {() => string} getHTML 返回当前 outerHTML 的函数
     */
    startAutoRefresh(ms = 60000, getHTML) {
      this.stopAutoRefresh();
      if (typeof getHTML !== 'function') {
        throw new Error('startAutoRefresh: 需要传入返回 outerHTML 的函数');
      }
      this._timer = setInterval(() => {
        this.refresh(getHTML()).catch(() => { /* 静默:定时刷新失败不打断 UI */ });
      }, ms);
    }

    stopAutoRefresh() {
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }
    }

    /**
     * 脱敏:移除内联 <script>,防止 appKey/Token 随快照外泄。
     * 硬要求:发送前必须剥离脚本。
     */
    _sanitize(html) {
      if (typeof html !== 'string') return '';
      return html.replace(
        /<script[\s\S]*?<\/script>/gi,
        '<script data-stripped></script>'
      );
    }
  }

  return AgenticWebData;
});