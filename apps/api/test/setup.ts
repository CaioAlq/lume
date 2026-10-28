// Roda antes de todos os testes (ver bunfig.toml). Cria um banco descartável no Postgres
// do .env.example (ou .env), aponta o apps/api/src/db/client.ts para ele e aplica as migrações de apps/api/drizzle. No fim, apaga.
// Assim todo `bun run test` também prova que as migrações aplicam e que a conexão abre.
import { afterAll } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const MIGRATIONS = join(import.meta.dir, '..', 'drizzle');
const TIMEOUT_MS = 15_000;

const { DB_PASSWORD, DB_NAME, DB_PORT } = process.env;
if (!DB_PASSWORD || !DB_NAME) {
  throw new Error('Faltam DB_PASSWORD e/ou DB_NAME. Rode com `bun run test`, que carrega o .env.example da raiz');
}
if (!existsSync(join(MIGRATIONS, 'meta', '_journal.json'))) {
  throw new Error('Nenhuma migração em apps/api/drizzle. Gere com `bunx drizzle-kit generate` (ver apps/api/docs/db-migrations.md)');
}

const admin = new pg.Client({
  host: '127.0.0.1',
  user: 'postgres',
  password: DB_PASSWORD,
  database: DB_NAME,
  port: Number(DB_PORT ?? 5432),
});
try {
  await admin.connect();
} catch (error) {
  throw new Error(`Banco fora do ar na porta ${DB_PORT ?? 5432}. Suba com: bun run db:up (da raiz do projeto)`, {
    cause: error,
  });
}

const testDb = `lume_test_${Date.now()}`;
await admin.query(`CREATE DATABASE ${testDb}`);

async function dropTestDb() {
  await admin.query(`DROP DATABASE IF EXISTS ${testDb} WITH (FORCE)`);
  await admin.end();
}

// Sem limite de tempo, uma conexão que nunca abre trava o `bun test` para sempre.
function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} não terminou em ${TIMEOUT_MS / 1000}s. A conexão do apps/api/src/db/client.ts abre?`)), TIMEOUT_MS),
    ),
  ]);
}

process.env.DB_NAME = testDb;
try {
  // Importa depois de trocar o DB_NAME, para o apps/api/src/db/client.ts conectar no banco descartável.
  const { db } = await import('../src/db/client.ts');
  await withTimeout(migrate(db, { migrationsFolder: MIGRATIONS }), 'Aplicar as migrações');
  afterAll(async () => {
    await db.$client.end();
    await dropTestDb();
  });
} catch (error) {
  await dropTestDb();
  throw error;
}
