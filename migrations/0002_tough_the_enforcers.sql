ALTER TABLE "insta_prospect_flows" ADD COLUMN "comment_reply_mode" text DEFAULT 'static';--> statement-breakpoint
ALTER TABLE "insta_prospect_flows" ADD COLUMN "comment_ai_prompt" text;--> statement-breakpoint
ALTER TABLE "insta_prospect_flows" ADD COLUMN "post_context" text;