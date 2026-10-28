CREATE TABLE "ticket_embedding" (
	"ticket_id" uuid PRIMARY KEY NOT NULL,
	"source_message_id" uuid NOT NULL,
	"model" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"message_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_kind_message_unique" UNIQUE("kind","message_id"),
	CONSTRAINT "job_kind_check" CHECK ("job"."kind" IN ('process_inbound', 'send_message')),
	CONSTRAINT "job_status_check" CHECK ("job"."status" IN ('pending', 'running', 'done', 'failed')),
	CONSTRAINT "job_attempts_check" CHECK ("job"."attempts" >= 0),
	CONSTRAINT "job_locked_at_check" CHECK (("job"."status" = 'running') = ("job"."locked_at" IS NOT NULL)),
	CONSTRAINT "job_last_error_check" CHECK ("job"."status" <> 'failed' OR "job"."last_error" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "ticket_embedding" ADD CONSTRAINT "ticket_embedding_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_embedding" ADD CONSTRAINT "ticket_embedding_source_message_id_message_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_embedding_embedding_idx" ON "ticket_embedding" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "ticket_embedding_source_message_id_idx" ON "ticket_embedding" USING btree ("source_message_id");--> statement-breakpoint
CREATE INDEX "job_message_id_idx" ON "job" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "job_run_after_pending_idx" ON "job" USING btree ("run_after") WHERE "job"."status" = 'pending';