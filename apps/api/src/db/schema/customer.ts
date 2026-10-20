import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Um cliente por endereço de e-mail (docs/data-model/tables-core.md). O e-mail
// é gravado em minúsculas: Joao@x.com e joao@x.com não virarem dois clientes.
export const customer = pgTable(
  'customer',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    email: text('email').notNull().unique(),
    displayName: text('display_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('customer_email_lower', sql`${table.email} = lower(${table.email})`)],
);
