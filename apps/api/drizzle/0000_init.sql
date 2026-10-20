CREATE TABLE "customer" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_email_unique" UNIQUE("email"),
	CONSTRAINT "customer_email_lower" CHECK ("customer"."email" = lower("customer"."email"))
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"password_hash" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_email_unique" UNIQUE("email"),
	CONSTRAINT "staff_kind_check" CHECK ("staff"."kind" IN ('human', 'ai')),
	CONSTRAINT "staff_login_check" CHECK (("staff"."kind" = 'human' AND "staff"."email" IS NOT NULL AND "staff"."password_hash" IS NOT NULL) OR
          ("staff"."kind" = 'ai'    AND "staff"."email" IS NULL     AND "staff"."password_hash" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "staff_session" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"staff_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "staff_session_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "staff_session" ADD CONSTRAINT "staff_session_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_session_staff_id_idx" ON "staff_session" USING btree ("staff_id");