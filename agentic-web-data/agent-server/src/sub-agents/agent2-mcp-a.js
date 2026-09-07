/**
 * 子Agent2(外部系统执行器·含LLM)。
 *
 * 职责:通过 LLM 判断该调用 MCP-A 的哪个 tool,取外部系统 API 数据。
 * 依赖:mcpClientA(列 tool / 调 tool)、llm.selectTool
 *
 * 支持两种路径:
 *   - 慢链路:传入 intent,由 LLM 现场选择 tool(并可回写 toolPlan 供缓存)
 *   - 快链路:传入 toolPlan(缓存复用),直接调 tool,跳过 LLM
 */

import { SubAgent } from './base.js';
import * as llm from '../llm/index.js';
import { mcpClientA } from '../mcp-client/index.js';

class McpAAgent extends SubAgent {
  constructor() {
    super('agent2-mcp-a');
  }

  /**
   * @param {{intent?:object, toolPlan?:{toolName:string,args:object}}} input
   * @returns {Promise<{rows:Array, toolPlan:object}>}
   */
  async _run(input) {
    const { intent, toolPlan } = input || {};
    let plan = toolPlan;

    // 快链路:无缓存计划时才走 LLM 选择(慢链路)
    if (!plan) {
      const tools = await mcpClientA.listTools();
      plan = await llm.selectTool(tools, intent || { goal: '取外部系统数据' });
    }

    const data = await mcpClientA.callTool(plan.toolName, plan.args);
    const rows = normalizeRows(data);
    return { rows, toolPlan: plan };
  }
}

/**
 * 将 MCP-A 返回的数据规整为行数组。
 */
function normalizeRows(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.rows)) return data.rows;
  if (data && Array.isArray(data.items)) return data.items;
  if (data == null) return [];
  return [data];
}

export { McpAAgent };