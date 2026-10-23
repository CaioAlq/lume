CREATE TABLE "ticket_participant" (
	"ticket_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_participant_ticket_id_customer_id_pk" PRIMARY KEY("ticket_id","customer_id")
);
--> statement-breakpoint
CREATE TABLE "ticket_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"staff_id" uuid,
	"kind" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_event_kind_check" CHECK ("ticket_event"."kind" IN ('status_changed', 'assigned', 'urgency_changed', 'category_changed', 'participant_added', 'participant_removed', 'marked_duplicate', 'archived', 'unarchived'))
);
--> statement-breakpoint
ALTER TABLE "ticket_participant" ADD CONSTRAINT "ticket_participant_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_participant" ADD CONSTRAINT "ticket_participant_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_event" ADD CONSTRAINT "ticket_event_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_event" ADD CONSTRAINT "ticket_event_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_participant_customer_id_idx" ON "ticket_participant" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "ticket_event_ticket_id_idx" ON "ticket_event" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "ticket_event_staff_id_idx" ON "ticket_event" USING btree ("staff_id");