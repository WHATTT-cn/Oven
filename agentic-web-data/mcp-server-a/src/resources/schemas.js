/**
 * MCP 服务端 A 的 resource:外部系统返回数据的 JSON Schema。
 * schema 即契约,供子 Agent2 的 LLM 理解结构、正确生成 API 参数。
 * ⚠️ 示例 schema:请按真实外部系统返回结构替换。
 */

export const SCHEMAS = {
  'external://schema/record': {
    type: 'object',
    properties: {
      record_id: { type: 'string' },
      title: { type: 'string' },
      created_date: { type: 'string', format: 'date' },
      region: { type: 'string' },
      category: { type: 'string' },
      status: { type: 'string' },
    },
  },
  'external://schema/detail': {
    type: 'object',
    properties: {
      record_id: { type: 'string' },
      description: { type: 'string' },
      value: { type: 'number' },
      updated_date: { type: 'string', format: 'date' },
    },
  },
};

export const RESOURCE_LIST = [
  { uri: 'external://schema/record', name: '记录数据结构', mimeType: 'application/json' },
  { uri: 'external://schema/detail', name: '明细数据结构', mimeType: 'application/json' },
];

/**
 * 按 uri 读取 schema。
 * @param {string} uri
 */
export function loadSchema(uri) {
  const schema = SCHEMAS[uri];
  if (!schema) throw new Error(`未知 resource: ${uri}`);
  return schema;
}