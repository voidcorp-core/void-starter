CREATE TABLE "job_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"reference" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "job_executions_idempotency_key_idx" ON "job_executions" USING btree ("idempotency_key");