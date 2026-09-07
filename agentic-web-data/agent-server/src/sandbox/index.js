/**
 * 沙箱模块 —— 执行 LLM 生成的清洗脚本的唯一入口。
 *
 * 安全护栏(架构第②层):
 *   - 禁网、禁文件系统、限内存、限超时
 *   - 生产使用 isolated-vm(独立 V8 Isolate,与主进程内存隔离)
 *   - ⚠️ 测试降级 USE_MOCK_SANDBOX=true 时,使用受限的 vm 模块本地执行(仅供联调,非安全边界)
 *
 * 另外提供 validateScript:执行前的静态校验(禁止危险关键字)。
 */

export const USE_MOCK_SANDBOX =
  String(process.env.USE_MOCK_SANDBOX || 'true') === 'true';

const MEMORY_LIMIT_MB = Number(process.env.SANDBOX_MEMORY_MB || 32);
const TIMEOUT_MS = Number(process.env.SANDBOX_TIMEOUT_MS || 1000);

// 禁止出现在清洗脚本中的危险关键字(静态校验)
const FORBIDDEN_PATTERNS = [
  /\brequire\b/,
  /\bprocess\b/,
  /\bglobalThis\b/,
  /\bimport\b/,
  /\beval\b/,
  /\bFunction\s*\(/,
  /\bfetch\b/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\b__proto__\b/,
];

/**
 * 静态校验:脚本必须定义 clean 函数,且不含危险关键字。
 * @returns {{ok: boolean, reason?: string}}
 */
export function validateScript(script) {
  if (typeof script !== 'string' || !script.trim()) {
    return { ok: false, reason: '脚本为空' };
  }
  if (!/function\s+clean\s*\(/.test(script)) {
    return { ok: false, reason: '脚本必须定义 function clean(rawRows)' };
  }
  for (const re of FORBIDDEN_PATTERNS) {
    if (re.test(script)) {
      return { ok: false, reason: `脚本包含禁止的关键字: ${re}` };
    }
  }
  return { ok: true };
}

/**
 * 使用 isolated-vm 执行脚本(生产路径)。
 * 动态 import,避免测试环境缺少原生依赖时启动失败。
 */
async function runWithIsolatedVm(script, rawRows) {
  // ⚠️ isolated-vm 为原生模块,需要编译工具链;生产环境须提前安装并构建
  const ivm = (await import('isolated-vm')).default;
  const isolate = new ivm.Isolate({ memoryLimit: MEMORY_LIMIT_MB });
  try {
    const context = await isolate.createContext();
    const jail = context.global;
    await jail.set('global', jail.derefInto());
    await jail.set('__RAW__', new ivm.ExternalCopy(rawRows).copyInto());

    const wrapped = `
      ${script}
      (function () {
        var out = clean(__RAW__);
        return JSON.stringify(out);
      })();
    `;
    const compiled = await isolate.compileScript(wrapped);
    const resultJson = await compiled.run(context, { timeout: TIMEOUT_MS });
    return JSON.parse(resultJson);
  } finally {
    isolate.dispose();
  }
}

/**
 * 使用内置 vm 执行脚本(测试降级路径)。
 * ⚠️ 注意:vm 模块并非安全边界,仅用于本地无原生依赖时联调。
 */
async function runWithNodeVm(script, rawRows) {
  const vm = await import('node:vm');
  const sandbox = Object.create(null);
  sandbox.__RAW__ = JSON.parse(JSON.stringify(rawRows || []));
  sandbox.__RESULT__ = '[]';
  const context = vm.createContext(sandbox);
  const wrapped = `
    ${script}
    __RESULT__ = JSON.stringify(clean(__RAW__));
  `;
  const s = new vm.Script(wrapped);
  s.runInContext(context, { timeout: TIMEOUT_MS });
  return JSON.parse(sandbox.__RESULT__);
}

/**
 * 沙箱执行统一入口:先静态校验,再在隔离环境运行清洗脚本。
 * @param {string} script  含 function clean(rawRows) 的脚本
 * @param {Array<object>} rawRows  原始数据行
 * @returns {Promise<Array<object>>} 清洗后的行
 */
export async function run(script, rawRows) {
  const v = validateScript(script);
  if (!v.ok) {
    throw new Error(`清洗脚本静态校验失败: ${v.reason}`);
  }
  if (USE_MOCK_SANDBOX) {
    return runWithNodeVm(script, rawRows);
  }
  return runWithIsolatedVm(script, rawRows);
}