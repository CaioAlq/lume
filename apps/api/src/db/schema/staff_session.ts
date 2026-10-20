import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { staff } from './staff.ts';

// Sessão de login dos atendentes humanos. O banco guarda só o hash do token (docs/data-model/tables-core.md).
export const staffSession = pgTable(
  'staff_session',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    staffId: uuid('staff_id').references(() => staff.id).notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    // O Postgres não cria índice para FK sozinho: staff_id é usado em busca e JOIN.
    index('staff_session_staff_id_idx').on(table.staffId),
  ],
);
