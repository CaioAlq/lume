import { defineConfig } from 'drizzle-kit';

// generate não conecta no banco; migrate conecta e precisa das variáveis.
const { DB_PASSWORD, DB_NAME, DB_PORT } = process.env;

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    host: '127.0.0.1',
    user: 'postgres',
    password: DB_PASSWORD,
    database: DB_NAME ?? '',
    port: Number(DB_PORT ?? 5432),
    ssl: false,
  },
});
