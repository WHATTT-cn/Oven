/**
 * LLM 模块 —— agent-server 中唯一直接与大模型交互的地方。
 *
 * 提供三个能力:
 *   1) analyzeFields(html, webFieldsSchema)  子Agent1:分析 HTML 产出字段映射 fieldMap
 *   2) selectTool(tools, intent)             子Agent2/3:根据可用 tool 列表选择要调用的 tool + 入参
 *   3) genCleanScript(fieldMap, sample)      生成"数据清洗脚本"(纯函数,沙箱执行)
 *
 * ⚠️ 测试环境降级:USE_MOCK_LLM=true 时全部走本地 mock,不请求真实大模型。
 *    生产环境必须置为 false,并配置 LLM_API_BASE / LLM_API_KEY / LLM_MODEL。
 */

export const USE_MOCK_LLM = String(process.env.USE_MOCK_LLM || 'true') === 'true';

// ⚠️ 硬编码占位:生产环境改为从环境变量/密钥管理服务读取
const LLM_API_BASE = process.env.LLM_API_BASE || 'https://api.example-llm.com/v1';
const LLM_API_KEY = process.env.LLM_API_KEY || 'LLM_API_KEY_PLACEHOLDER';
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

/**
 * 统一的底层调用封装(function-calling 风格)。
 * 生产:走真实 HTTP 调用;测试:抛错以提醒调用方应命中 mock 分支。
 */
async function callLLM({ system, user, tools }) {
  if (USE_MOCK_LLM) {
    throw new Error('callLLM 不应在 USE_MOCK_LLM=true 时被直接调用');
  }
  // ⚠️ 生产实现:此处对接真实大模型(OpenAI 兼容协议示例)
  const resp = await fetch(`${LLM_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      tools,
      temperature: 0,
    }),
  });
  if (!resp.ok) {
    throw new Error(`LLM 调用失败: ${resp.status}`);
  }
  return resp.json();
}

/**
 * 子Agent1:纯分析。读取 HTML 结构,推断页面需要哪些字段,产出 fieldMap。
 * fieldMap 形如 { title: 'h1', region: '.region', ... },描述"字段 → 数据来源"。
 * @returns {Promise<{fieldMap: object, confidence: number}>}
 */
export async function analyzeFields(html, webFieldsSchema) {
  if (USE_MOCK_LLM) {
    // mock:直接根据 schema 的 properties 生成占位映射
    const props = (webFieldsSchema && webFieldsSchema.properties) || {};
    const fieldMap = {};
    for (const key of Object.keys(props)) {
      fieldMap[key] = `source.${key}`; // ⚠️ 示例映射:真实场景由 LLM 解析 HTML 得出
    }
    return { fieldMap, confidence: 0.6 };
  }

  const system =
    '你是网页字段分析师。根据给定 HTML 和目标 schema,推断每个字段的数据来源,只输出 JSON。';
  const user = `HTML:\n${html}\n\n目标字段 schema:\n${JSON.stringify(webFieldsSchema)}`;
  const res = await callLLM({ system, user });
  const text = res?.choices?.[0]?.message?.content || '{}';
  return { fieldMap: JSON.parse(text), confidence: 0.9 };
}

/**
 * 子Agent2/3:根据可用 tool 列表和意图,选择要调用的 tool 及入参。
 * @param {Array<{name:string, description?:string, inputSchema?:object}>} tools
 * @param {object} intent  { goal, fieldMap, hints }
 * @returns {Promise<{toolName: string, args: object}>}
 */
export async function selectTool(tools, intent) {
  if (USE_MOCK_LLM) {
    // mock:选择列表中第一个 tool,入参给空对象或最小占位
    const first = (tools && tools[0]) || null;
    if (!first) throw new Error('没有可用的 tool 供选择');
    return { toolName: first.name, args: {} }; // ⚠️ 示例:真实场景由 LLM 依据 intent 决定
  }

  const system =
    '你是执行规划器。根据意图和可用工具,选择一个最合适的工具并给出入参,只输出 JSON: {"toolName":...,"args":...}。';
  const user = `意图:\n${JSON.stringify(intent)}\n\n可用工具:\n${JSON.stringify(tools)}`;
  const res = await callLLM({ system, user, tools });
  const text = res?.choices?.[0]?.message?.content || '{}';
  return JSON.parse(text);
}

/**
 * 生成清洗脚本:输入 fieldMap 与样本行,产出一个纯函数体字符串。
 * 该脚本随后必须经过 validateScript 静态校验并在 isolated-vm 沙箱中执行。
 * 约定:脚本导出 function clean(rawRows) { return rows; }
 * @returns {Promise<{script: string}>}
 */
export async function genCleanScript(fieldMap, sample) {
  if (USE_MOCK_LLM) {
    // mock:生成一个恒等清洗脚本(仅做字段裁剪),⚠️ 示例脚本
    const keys = Object.keys(fieldMap || {});
    const script = [
      'function clean(rawRows) {',
      '  var allow = ' + JSON.stringify(keys) + ';',
      '  return (rawRows || []).map(function (r) {',
      '    var o = {};',
      '    for (var i = 0; i < allow.length; i++) {',
      '      var k = allow[i];',
      '      if (r[k] !== undefined) o[k] = r[k];',
      '    }',
      '    return o;',
      '  });',
      '}',
    ].join('\n');
    return { script };
  }

  const system =
    '你是数据清洗脚本生成器。生成一个名为 clean(rawRows) 的纯函数,禁止访问网络/文件系统,只做数据整形,只输出代码。';
  const user = `字段映射:\n${JSON.stringify(fieldMap)}\n\n样本数据:\n${JSON.stringify(sample)}`;
  const res = await callLLM({ system, user });
  const script = res?.choices?.[0]?.message?.content || 'function clean(r){return r;}';
  return { script };
}