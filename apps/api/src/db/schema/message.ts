import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { customer } from './customer.ts';
import { staff } from './staff.ts';
import { ticket } from './ticket.ts';

// As falas da conversa, intercaladas, para serem lidas em ordem (docs/data-model/tables-core.md).
export const message = pgTable(
  'message',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    ticketId: uuid('ticket_id').references(() => ticket.id).notNull(),
    customerId: uuid('customer_id').references(() => customer.id),
    staffId: uuid('staff_id').references(() => staff.id),
    body: text('body').notNull(),
    messageIdHeader: text('message_id_header').notNull().unique(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    deliveryStatus: text('delivery_status'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    recipients: text('recipients').array(),
  },
  (table) => [
    // Exatamente um autor: cliente ou equipe, nunca os dois nem nenhum.
    check('message_single_author_check', sql`num_nonnulls(${table.customerId}, ${table.staffId}) = 1`),
    // Recebida não tem dados de envio.
    check(
      'message_received_no_delivery_check',
      sql`${table.customerId} IS NULL OR (${table.deliveryStatus} IS NULL AND ${table.recipients} IS NULL AND ${table.sentAt} IS NULL)`,
    ),
    // Enviada tem dados de envio.
    check(
      'message_sent_delivery_check',
      sql`${table.staffId} IS NULL OR (${table.deliveryStatus} IS NOT NULL AND ${table.recipients} IS NOT NULL)`,
    ),
    // delivery_status só aceita pending, sent e failed.
    check('message_delivery_status_check', sql`${table.deliveryStatus} IN ('pending', 'sent', 'failed')`),
    // sent_at preenchido se, e somente se, delivery_status = sent.
    check(
      'message_sent_at_check',
      sql`(${table.deliveryStatus} = 'sent') = (${table.sentAt} IS NOT NULL)`,
    ),
    // FKs usadas em busca e JOIN ganham índice (o Postgres não cria sozinho).
    index('message_ticket_id_idx').on(table.ticketId),
    index('message_customer_id_idx').on(table.customerId),
    index('message_staff_id_idx').on(table.staffId),
  ],
);
