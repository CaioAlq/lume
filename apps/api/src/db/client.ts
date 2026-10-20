import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index.ts';

// Falha na hora se faltar variável, em vez de montar uma conexão com "undefined".
const { DB_PASSWORD, DB_NAME, DB_PORT } = process.env;
if (!DB_PASSWORD || !DB_NAME) {
  throw new Error('Faltam DB_PASSWORD e/ou DB_NAME (o .env fica na raiz do projeto)');
}

const pool = new Pool({
  host: '127.0.0.1',
  user: 'postgres',
  password: DB_PASSWORD,
  database: DB_NAME,
  port: Number(DB_PORT ?? 5432),
});

export const db = drizzle(pool, { schema });
