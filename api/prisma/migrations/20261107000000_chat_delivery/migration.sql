-- Additive: per-thread "delivered" watermarks for Messages read receipts (✓✓ grey).
-- Safe to run at any time; the API detects the columns and falls back to sent/seen ticks until then.
ALTER TABLE "chat_threads" ADD COLUMN IF NOT EXISTS "delivered_at_a" TIMESTAMP(3);
ALTER TABLE "chat_threads" ADD COLUMN IF NOT EXISTS "delivered_at_b" TIMESTAMP(3);
