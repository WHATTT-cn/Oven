/**
 * 子Agent3(数据库执行器·含LLM)。
 *
 * 职责:通过 LLM 判断该调用 MCP-B 的哪个 tool,读写结构化/非结构化数据库。
 * 依赖:mcpClientB(列 tool / 调 tool)、llm.selectTool
 *
 * 与 agent2 对称,同样支持慢链路(LLM 选 tool)/ 快链路(复用 toolPlan)。
 * ⚠️ 写操作(insert/update/delete/put)在 MCP-B 内部已做参数化 + where 强校验,
 *    首次生成的 toolPlan 建议经人工审核后再缓存(架构护栏第④层)。
 */

import { SubAgent } from './base.js';
import * as llm from '../llm/index.js';
import { mcpClientB } from '../mcp-client/index.js';

class McpBAgent extends SubAgent {
  constructor() {
    super('agent3-mcp-b');
  }

  /**
   * @param {{intent?:object, toolPlan?:{toolName:string,args:object}}} input
   * @returns {Promise<{rows:Array, toolPlan:object}>}
   */
  async _run(input) {
    const { intent, toolPlan } = input || {};
    let plan = toolPlan;

    if (!plan) {
      const tools = await mcpClientB.listTools();
      plan = await llm.selectTool(tools, intent || { goal: '读取数据库数据' });
    }

    const data = await mcpClientB.callTool(plan.toolName, plan.args);
    const rows = normalizeRows(data);
    return { rows, toolPlan: plan };
  }
}

/**
 * 将 MCP-B 返回的数据规整为行数组。
 */
function normalizeRows(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.rows)) return data.rows;
  if (data && Array.isArray(data.docs)) return data.docs;
  if (data == null) return [];
  return [data];
}

export { McpBAgent };