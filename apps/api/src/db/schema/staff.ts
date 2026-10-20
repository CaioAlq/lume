import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Quem responde pelo suporte. A LLM também é um staff, com UUID próprio (docs/data-model/tables-core.md).
export const staff = pgTable(
  'staff',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    kind: text('kind').notNull(),
    displayName: text('display_name').notNull(),
    email: text('email').unique(),
    passwordHash: text('password_hash'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('staff_kind_check', sql`${table.kind} IN ('human', 'ai')`),
    // IA não faz login; humano faz. O banco garante os dois juntos.
    check(
      'staff_login_check',
      sql`(${table.kind} = 'human' AND ${table.email} IS NOT NULL AND ${table.passwordHash} IS NOT NULL) OR
          (${table.kind} = 'ai'    AND ${table.email} IS NULL     AND ${table.passwordHash} IS NULL)`,
    ),
  ],
);
