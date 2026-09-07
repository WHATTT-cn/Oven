/**
 * 外部系统鉴权:Token 只留在本模块,Agent 与前端都拿不到。
 * ⚠️ 示例实现:静态 token 直接返回 / OAuth 走 client_credentials(伪实现)。
 *    生产环境应接入真实鉴权中心,并对 token 做缓存与过期刷新。
 */

let _cachedToken = null;
let _expireAt = 0;

/**
 * 获取外部系统访问 token。
 * @returns {Promise<string>}
 */
export async function getExternalToken() {
  // 优先使用静态 token(测试/简单场景)
  const staticToken = process.env.EXTERNAL_API_TOKEN;
  if (staticToken && staticToken !== 'REPLACE_WITH_REAL_TOKEN') {
    return staticToken;
  }

  // 未过期则复用缓存
  if (_cachedToken && Date.now() < _expireAt) {
    return _cachedToken;
  }

  const clientId = process.env.EXTERNAL_API_CLIENT_ID;
  const clientSecret = process.env.EXTERNAL_API_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    // ⚠️ 测试环境降级:无任何凭据时返回占位 token,便于本地联调
    return 'DEV_FAKE_TOKEN';
  }

  // OAuth client_credentials(示例:请替换为真实鉴权端点)
  const res = await fetch(`${process.env.EXTERNAL_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`获取外部系统 token 失败: ${res.status}`);
  const data = await res.json();
  _cachedToken = data.access_token;
  _expireAt = Date.now() + (data.expires_in || 3600) * 1000 - 60000;
  return _cachedToken;
}