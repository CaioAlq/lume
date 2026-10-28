CREATE TABLE "ai_run" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"task" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text,
	"status" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"output" jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_run_task_check" CHECK ("ai_run"."task" IN ('classify', 'embed', 'draft')),
	CONSTRAINT "ai_run_status_check" CHECK ("ai_run"."status" IN ('succeeded', 'failed')),
	CONSTRAINT "ai_run_status_error_check" CHECK ((
        ("ai_run"."status" <> 'failed' OR "ai_run"."error_message" IS NOT NULL)
        AND
        ("ai_run"."error_message" IS NULL OR "ai_run"."status" = 'failed')
      )),
	CONSTRAINT "ai_run_failed_output_check" CHECK ("ai_run"."status" <> 'failed' OR "ai_run"."output" IS NULL),
	CONSTRAINT "ai_run_prompt_version_check" CHECK ((
        ("ai_run"."task" <> 'embed' OR "ai_run"."prompt_version" IS NULL)
        AND
        ("ai_run"."task" = 'embed' OR "ai_run"."prompt_version" IS NOT NULL)
      )),
	CONSTRAINT "ai_run_latency_check" CHECK ("ai_run"."latency_ms" >= 0),
	CONSTRAINT "ai_run_input_tokens_check" CHECK ("ai_run"."input_tokens" IS NULL OR "ai_run"."input_tokens" >= 0),
	CONSTRAINT "ai_run_output_tokens_check" CHECK ("ai_run"."output_tokens" IS NULL OR "ai_run"."output_tokens" >= 0)
);
--> statement-breakpoint
CREATE TABLE "draft" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"ai_run_id" uuid NOT NULL,
	"body" text NOT NULL,
	"status" text NOT NULL,
	"message_id" uuid,
	"edited" boolean,
	"decided_by_staff_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_message_id_unique" UNIQUE("message_id"),
	CONSTRAINT "draft_status_check" CHECK ("draft"."status" IN ('pending', 'sent', 'discarded')),
	CONSTRAINT "draft_sent_check" CHECK ((
        ("draft"."status" <> 'sent' AND "draft"."message_id" IS NULL AND "draft"."edited" IS NULL)
        OR
        ("draft"."status" = 'sent' AND "draft"."message_id" IS NOT NULL AND "draft"."edited" IS NOT NULL)
      )),
	CONSTRAINT "draft_decided_at_check" CHECK (("draft"."status" <> 'pending') = ("draft"."decided_at" IS NOT NULL)),
	CONSTRAINT "draft_decided_by_staff_check" CHECK ((
        ("draft"."status" <> 'pending' OR "draft"."decided_by_staff_id" IS NULL)
        AND
        ("draft"."status" <> 'sent' OR "draft"."decided_by_staff_id" IS NOT NULL)
      ))
);
--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft" ADD CONSTRAINT "draft_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft" ADD CONSTRAINT "draft_ai_run_id_ai_run_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft" ADD CONSTRAINT "draft_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft" ADD CONSTRAINT "draft_decided_by_staff_id_staff_id_fk" FOREIGN KEY ("decided_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_run_ticket_id_idx" ON "ai_run" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "ai_run_message_id_idx" ON "ai_run" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "draft_ticket_id_idx" ON "draft" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "draft_ai_run_id_idx" ON "draft" USING btree ("ai_run_id");--> statement-breakpoint
CREATE INDEX "draft_decided_by_staff_id_idx" ON "draft" USING btree ("decided_by_staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "draft_ticket_id_pending_unique" ON "draft" USING btree ("ticket_id") WHERE "draft"."status" = 'pending';