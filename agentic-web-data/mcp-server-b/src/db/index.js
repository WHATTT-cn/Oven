/**
 * 数据库连接层:连接串只留在本模块。
 * - 结构化:MySQL 连接池(mysql2/promise)
 * - 非结构化:MongoDB 客户端
 * ⚠️ USE_MOCK_DB=true 时使用内存 mock,便于无真实数据库的本地联调 —— 生产必须关闭。
 */
import mysql from 'mysql2/promise';
import { MongoClient } from 'mongodb';

const USE_MOCK = String(process.env.USE_MOCK_DB).toLowerCase() === 'true';

let _pool = null;
let _mongo = null;

// ==================== 内存 Mock(测试环境) ====================
const mockTables = {
  records: [
    { id: 'R001', title: '示例记录A', region: '华北', category_id: 1, created_date: '2026-01-01' },
    { id: 'R002', title: '示例记录B', region: '华东', category_id: 2, created_date: '2026-02-15' },
  ],
};
const mockCollections = {
  events: [
    { _id: 'E001', title: '事件A', tags: ['x'], payload: { v: 1 }, created_at: '2026-03-01' },
  ],
};

function mockPool() {
  return {
    async query(sql /* , params */) {
      // ⚠️ mock 仅覆盖极少量语句,用于联调冒烟,不做真实解析
      if (/^SHOW TABLES/i.test(sql)) {
        return [Object.keys(mockTables).map((t) => ({ Tables_in_mock: t }))];
      }
      if (/information_schema/i.test(sql)) {
        return [[
          { COLUMN_NAME: 'id', DATA_TYPE: 'varchar', IS_NULLABLE: 'NO', COLUMN_KEY: 'PRI' },
          { COLUMN_NAME: 'title', DATA_TYPE: 'varchar', IS_NULLABLE: 'NO', COLUMN_KEY: '' },
        ]];
      }
      if (/^SELECT/i.test(sql)) return [mockTables.records];
      return [{ insertId: 'MOCK_ID', affectedRows: 1 }];
    },
  };
}

function mockMongo() {
  return {
    db() {
      return {
        collection(name) {
          const data = mockCollections[name] || [];
          return {
            find: () => ({ limit: () => ({ toArray: async () => data }) }),
            findOne: async () => data[0] || null,
            insertOne: async () => ({ insertedId: 'MOCK_MONGO_ID' }),
            indexes: async () => [{ name: '_id_', key: { _id: 1 } }],
          };
        },
        listCollections: () => ({ toArray: async () => Object.keys(mockCollections).map((name) => ({ name })) }),
      };
    },
  };
}

// ==================== 真实连接 ====================
export function getPool() {
  if (USE_MOCK) return mockPool();
  if (!_pool) {
    _pool = mysql.createPool({
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      connectionLimit: 10,
      waitForConnections: true,
    });
  }
  return _pool;
}

export function getMongo() {
  if (USE_MOCK) return mockMongo();
  if (!_mongo) {
    _mongo = new MongoClient(process.env.MONGO_URI);
    _mongo.connect().catch((e) => console.error('[mcp-server-b] Mongo 连接失败', e));
    // 包一层:统一 .db() 接口默认库
    return {
      db: () => _mongo.db(process.env.MONGO_DB),
    };
  }
  return { db: () => _mongo.db(process.env.MONGO_DB) };
}

export const IS_MOCK = USE_MOCK;