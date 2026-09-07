/**
 * tool: callExternalAPI —— 调用外部系统 REST API 获取业务数据。
 * 鉴权封装在 MCP 内部,Agent 只提供 endpoint 与 params。
 */
import { getExternalToken } from '../auth/external-token.js';

export const TOOL_DEFINITION = {
  name: 'callExternalAPI',
  description: '调用外部系统 REST API 获取业务数据(记录/明细/统计等)',
  inputSchema: {
    type: 'object',
    properties: {
      endpoint: { type: 'string', description: '如 /list, /detail' },
      params: { type: 'object', description: '查询参数,如 {country:"德国"}' },
      method: { type: 'string', enum: ['GET', 'POST'], description: '默认 GET' },
    },
    required: ['endpoint'],
  },
};

// endpoint 白名单:仅允许已知只读接口,防 SSRF / 越权
const ENDPOINT_WHITELIST = ['/list', '/detail', '/stats'];

/**
 * @param {{endpoint:string, params?:object, method?:string}} args
 * @returns {Promise<object>} 外部系统返回的 JSON
 */
export async function callExternalAPI(args) {
  const { endpoint, params = {}, method = 'GET' } = args;

  if (!ENDPOINT_WHITELIST.includes(endpoint)) {
    throw new Error(`endpoint 不在白名单内: ${endpoint}`);
  }

  const base = process.env.EXTERNAL_API_BASE || 'https://ext.example.com/api';
  const token = await getExternalToken();

  let url = `${base}${endpoint}`;
  const options = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };

  if (method === 'GET') {
    const qs = new URLSearchParams(params).toString();
    if (qs) url += `?${qs}`;
  } else {
    options.body = JSON.stringify(params);
  }

  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`External ${endpoint} 返回 ${res.status}`);
  return res.json();
}