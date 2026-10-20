// Ajudantes dos testes de regra do banco. As consultas passam pelo apps/api/src/db/client.ts de verdade.
import { expect } from 'bun:test';
import type { SQL } from 'drizzle-orm';
import { db } from '../../src/db/client.ts';

// Códigos de erro do Postgres para as regras que o banco garante.
export const CHECK_VIOLATION = '23514';
export const UNIQUE_VIOLATION = '23505';
export const FOREIGN_KEY_VIOLATION = '23503';

export async function rows<T>(query: SQL): Promise<T[]> {
  const result = await db.execute(query);
  return result.rows as T[];
}

// O Drizzle embrulha o erro do pg; o código do Postgres fica em algum `cause` da cadeia.
function postgresCode(error: unknown): string | undefined {
  let current: unknown = error;
  while (current instanceof Error) {
    if ('code' in current && typeof current.code === 'string') return current.code;
    current = current.cause;
  }
  return undefined;
}

// O banco tem que recusar o comando, e pelo motivo certo (o código do Postgres).
export async function expectRejected(query: SQL, code: string): Promise<void> {
  let error: unknown;
  try {
    await db.execute(query);
  } catch (caught) {
    error = caught;
  }
  expect(error, 'o banco aceitou um comando que a modelagem proíbe').toBeDefined();
  expect(postgresCode(error)).toBe(code);
}

// Valor único por teste, para os testes não colidirem entre si.
export function unique(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
