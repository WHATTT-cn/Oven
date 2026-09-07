/**
 * 子 Agent 基类。
 * 约定所有子 Agent 暴露 run(input) -> Promise<result>,
 * 并统一携带 name 用于监管者(Supervisor)编排与 trace 记录。
 */
class SubAgent {
  /**
   * @param {string} name 子 Agent 名称
   */
  constructor(name) {
    this.name = name;
  }

  /**
   * 统一执行入口,子类必须实现 _run。
   * 外层包裹 trace,便于监管者审计。
   */
  async run(input) {
    const startedAt = Date.now();
    try {
      const output = await this._run(input);
      return {
        agent: this.name,
        ok: true,
        output,
        costMs: Date.now() - startedAt,
      };
    } catch (err) {
      return {
        agent: this.name,
        ok: false,
        error: err.message,
        costMs: Date.now() - startedAt,
      };
    }
  }

  // eslint-disable-next-line no-unused-vars
  async _run(input) {
    throw new Error(`${this.name} 未实现 _run`);
  }
}

export { SubAgent };