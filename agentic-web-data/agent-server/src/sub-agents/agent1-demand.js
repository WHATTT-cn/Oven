/**
 * 子Agent1(分析师·上游·纯分析)。
 *
 * 职责:分析前端 HTML,产出字段映射 fieldMap 传给下游。
 * 特点:纯分析,不做 function calling(不调用任何 MCP tool)。
 * 依赖:llm.analyzeFields(html, schema)
 */

import { SubAgent } from './base.js';
import * as llm from '../llm/index.js';

class DemandAgent extends SubAgent {
  constructor() {
    super('agent1-demand');
  }

  /**
   * @param {{html:string, webFieldsSchema:object}} input
   * @returns {Promise<{fieldMap:object, confidence:number}>}
   */
  async _run(input) {
    const { html, webFieldsSchema } = input || {};
    if (!html) throw new Error('agent1 需要 html 输入');
    const { fieldMap, confidence } = await llm.analyzeFields(
      html,
      webFieldsSchema
    );
    if (!fieldMap || Object.keys(fieldMap).length === 0) {
      throw new Error('agent1 未能产出有效 fieldMap');
    }
    return { fieldMap, confidence };
  }
}

export { DemandAgent};