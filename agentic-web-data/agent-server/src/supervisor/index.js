/**
 * 监管者 Agent(Supervisor)。
 *
 * 职责(架构核心编排):
 *   - 拆解任务、调度子 Agent、质检核验、不合格退回重试
 *   - 慢/快链路分离:字段映射 + tool 调用计划 + 清洗脚本"学一次缓存"
 *   - 汇总多数据源 → 沙箱清洗 → schema 校验 → 终检 → 返回 rows + trace
 *
 * 依赖:agent1/2/3、llm.genCleanScript、sandbox.run/validateScript、cache、ajv 校验。
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import { DemandAgent } from '../sub-agents/agent1-demand.js';
import { McpAAgent } from '../sub-agents/agent2-mcp-a.js';
import { McpBAgent } from '../sub-agents/agent3-mcp-b.js';
import * as llm from '../llm/index.js';
import * as sandbox from '../sandbox/index.js';
import * as cache from '../cache/index.js';

const MAX_RETRY = Number(process.env.SUPERVISOR_MAX_RETRY || 1);

class Supervisor {
  /**
   * @param {object} webFieldsSchema shared/web-fields.schema.json 内容
   */
  constructor(webFieldsSchema) {
    this.webFieldsSchema = webFieldsSchema;
    this.agent1 = new DemandAgent();
    this.agent2 = new McpAAgent();
    this.agent3 = new McpBAgent();

    const ajv = new Ajv({ allErrors: true, removeAdditional: true });
    addFormats(ajv);
    // 校验"单行"的 schema
    this.validateRow = ajv.compile(webFieldsSchema);
  }

  /**
   * verify:质检核验。用于监管者对子 Agent 产物做基本合法性检查。
   */
  verify(stage, result) {
    if (!result || result.ok === false) {
      throw new Error(`[verify:${stage}] 子任务失败: ${result?.error || '未知'}`);
    }
    return result.output;
  }

  /**
   * 校验清洗后的行数组,过滤/收集非法行。
   */
  validateRows(rows) {
    const valid = [];
    const errors = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (this.validateRow(row)) {
        valid.push(row);
      } else {
        errors.push({ index: i, errors: this.validateRow.errors });
      }
    }
    return { valid, errors };
  }

  /**
   * refresh 主流水线。
   * @param {{html:string, intentA?:object, intentB?:object}} req
   * @returns {Promise<{rows:Array, trace:object}>}
   */
  async refresh(req) {
    const { html } = req || {};
    if (!html) throw new Error('supervisor.refresh 需要 html');

    const trace = { path: 'unknown', steps: [] };

    // 1) 查缓存(HTML 指纹)
    let plan = await cache.getPlan(html);

    if (!plan) {
      // ===== 慢链路:学习字段映射 + 生成清洗脚本 =====
      trace.path = 'slow';

      const r1 = await this.agent1.run({ html, webFieldsSchema: this.webFieldsSchema });
      const a1 = this.verify('agent1', r1);
      trace.steps.push({ agent: 'agent1', costMs: r1.costMs });

      const { script } = await llm.genCleanScript(a1.fieldMap, []);
      const sv = sandbox.validateScript(script);
      if (!sv.ok) throw new Error(`清洗脚本校验失败: ${sv.reason}`);

      plan = { fieldMap: a1.fieldMap, cleanScript: script, toolPlanA: null, toolPlanB: null };
    } else {
      trace.path = 'fast';
    }

    // 2) 并行派发 agent2 + agent3(快链路复用缓存 toolPlan)
    const [r2, r3] = await Promise.all([
      this.agent2.run({ intent: req.intentA, toolPlan: plan.toolPlanA }),
      this.agent3.run({ intent: req.intentB, toolPlan: plan.toolPlanB }),
    ]);
    const a2 = this.verify('agent2', r2);
    const a3 = this.verify('agent3', r3);
    trace.steps.push({ agent: 'agent2', costMs: r2.costMs });
    trace.steps.push({ agent: 'agent3', costMs: r3.costMs });

    // 回写本轮实际使用的 toolPlan(供缓存固化)
    plan.toolPlanA = a2.toolPlan;
    plan.toolPlanB = a3.toolPlan;

    // 3) 汇总多数据源
    const merged = this.mergeSources([a2.rows, a3.rows]);

    // 4) 沙箱清洗
    let cleaned = await sandbox.run(plan.cleanScript, merged);

    // 5) schema 校验(不合格退回重试:重新生成脚本)
    let { valid, errors } = this.validateRows(cleaned);
    let retry = 0;
    while (errors.length > 0 && retry < MAX_RETRY && !cache.USE_MOCK_CACHE) {
      retry += 1;
      const { script } = await llm.genCleanScript(plan.fieldMap, merged.slice(0, 3));
      const sv = sandbox.validateScript(script);
      if (!sv.ok) break;
      plan.cleanScript = script;
      cleaned = await sandbox.run(plan.cleanScript, merged);
      ({ valid, errors } = this.validateRows(cleaned));
    }
    trace.steps.push({ stage: 'validate', valid: valid.length, invalid: errors.length, retry });

    // 6) 监管者终检:至少要有合法行(允许空,但记录)
    if (valid.length === 0 && merged.length > 0) {
      trace.warning = '清洗后无合法行,请检查 fieldMap 与清洗脚本';
    }

    // 7) 缓存固化(学一次缓存)——快链路后续直接命中
    //    ⚠️ 生产建议:首次 plan 需经人工审核后再写缓存(护栏第④层)
    await cache.setPlan(html, plan);

    return { rows: valid, trace };
  }

  /**
   * 合并多个数据源的行(简单拼接,可按 id 去重)。
   */
  mergeSources(sources) {
    const all = [];
    for (const s of sources) {
      if (Array.isArray(s)) all.push(...s);
    }
    // 按 id 去重(后者覆盖前者)
    const map = new Map();
    for (const row of all) {
      const key = row && row.id != null ? row.id : Symbol();
      map.set(key, row);
    }
    return Array.from(map.values());
  }
}

export { Supervisor };