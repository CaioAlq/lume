CREATE TABLE "ticket" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"customer_id" uuid NOT NULL,
	"staff_id" uuid,
	"subject" text NOT NULL,
	"status" text NOT NULL,
	"urgency" text,
	"category" text,
	"archived" boolean DEFAULT false NOT NULL,
	"duplicate_of_ticket_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "ticket_status_check" CHECK ("ticket"."status" IN ('open', 'awaiting_staff', 'awaiting_customer', 'resolved')),
	CONSTRAINT "ticket_urgency_check" CHECK ("ticket"."urgency" IN ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "ticket_resolved_check" CHECK (("ticket"."status" = 'resolved') = ("ticket"."resolved_at" IS NOT NULL)),
	CONSTRAINT "ticket_duplicate_check" CHECK ("ticket"."duplicate_of_ticket_id" <> "ticket"."id")
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"customer_id" uuid,
	"staff_id" uuid,
	"body" text NOT NULL,
	"message_id_header" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"delivery_status" text,
	"sent_at" timestamp with time zone,
	"recipients" text[],
	CONSTRAINT "message_message_id_header_unique" UNIQUE("message_id_header"),
	CONSTRAINT "message_single_author_check" CHECK (num_nonnulls("message"."customer_id", "message"."staff_id") = 1),
	CONSTRAINT "message_received_no_delivery_check" CHECK ("message"."customer_id" IS NULL OR ("message"."delivery_status" IS NULL AND "message"."recipients" IS NULL AND "message"."sent_at" IS NULL)),
	CONSTRAINT "message_sent_delivery_check" CHECK ("message"."staff_id" IS NULL OR ("message"."delivery_status" IS NOT NULL AND "message"."recipients" IS NOT NULL)),
	CONSTRAINT "message_delivery_status_check" CHECK ("message"."delivery_status" IN ('pending', 'sent', 'failed')),
	CONSTRAINT "message_sent_at_check" CHECK (("message"."delivery_status" = 'sent') = ("message"."sent_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_duplicate_of_ticket_id_ticket_id_fk" FOREIGN KEY ("duplicate_of_ticket_id") REFERENCES "public"."ticket"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_customer_id_idx" ON "ticket" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "ticket_staff_id_idx" ON "ticket" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "ticket_duplicate_of_ticket_id_idx" ON "ticket" USING btree ("duplicate_of_ticket_id");--> statement-breakpoint
CREATE INDEX "message_ticket_id_idx" ON "message" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "message_customer_id_idx" ON "message" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "message_staff_id_idx" ON "message" USING btree ("staff_id");