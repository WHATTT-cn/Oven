/**
 * 缓存模块 —— 实现"慢/快链路分离"的关键。
 *
 * 以 HTML 指纹为 key,缓存一次"学习"得到的:
 *   { fieldMap, toolPlan, cleanScript }
 * 快链路命中后可直接复用缓存,跳过 LLM 分析与脚本生成。
 *
 * ⚠️ 测试降级 USE_MOCK_CACHE=true 时,使用进程内 Map(重启即失效)。
 *    生产环境置为 false,配置 REDIS_URL 使用 Redis(ioredis)。
 */

import crypto from 'node:crypto';

export const USE_MOCK_CACHE =
  String(process.env.USE_MOCK_CACHE || 'true') === 'true';
// ⚠️ 硬编码占位:生产改为环境变量注入
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const CACHE_PREFIX = process.env.CACHE_PREFIX || 'awd:plan:';
const CACHE_TTL_SEC= Number(process.env.CACHE_TTL_SEC || 86400);

// 进程内 mock 存储
const memStore = new Map();
let redisClient = null;

/**
 * 计算 HTML 指纹(sha256),作为缓存 key 的稳定标识。
 */
export function fingerprint(html) {
  return crypto
    .createHash('sha256')
    .update(String(html || ''))
    .digest('hex');
}

function keyOf(fp) {
  return `${CACHE_PREFIX}${fp}`;
}

/**
 * 惰性获取 Redis 客户端(生产路径,基于 ioredis)。
 */
async function getRedis() {
  if (redisClient) return redisClient;
  // ⚠️ 生产依赖:package.json 已声明 ioredis
  const Redis = (await import('ioredis')).default;
  redisClient = new Redis(REDIS_URL);
  redisClient.on('error', (e) => {
    console.error('[cache] redis error:', e.message);
  });
  return redisClient;
}

/**
 * 读取缓存的执行计划。
 * @param {string} html
 * @returns {Promise<null | {fieldMap:object, toolPlan:object, cleanScript:string}>}
 */
export async function getPlan(html) {
  const fp = fingerprint(html);
  if (USE_MOCK_CACHE) {
    return memStore.get(keyOf(fp)) || null;
  }
  const client = await getRedis();
  const raw = await client.get(keyOf(fp));
  return raw ? JSON.parse(raw) : null;
}

/**
 * 写入缓存的执行计划(学一次缓存)。
 * @param {string} html
 * @param {{fieldMap:object, toolPlan:object, cleanScript:string}} plan
 */
export async function setPlan(html, plan) {
  const fp = fingerprint(html);
  if (USE_MOCK_CACHE) {
    memStore.set(keyOf(fp), plan);
    return;
  }
  const client = await getRedis();
  await client.set(keyOf(fp), JSON.stringify(plan), 'EX', CACHE_TTL_SEC);
}

/**
 * 失效缓存(字段变更感知时调用)。
 */
export async function invalidate(html) {
  const fp = fingerprint(html);
  if (USE_MOCK_CACHE) {
    memStore.delete(keyOf(fp));
    return;
  }
  const client = await getRedis();
  await client.del(keyOf(fp));
}

export async function close() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}