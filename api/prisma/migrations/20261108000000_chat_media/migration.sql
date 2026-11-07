-- Messages: photos, voice notes, documents, replies, reactions and "delete for everyone".
-- Additive and idempotent. Existing rows become kind = 'text'.
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'text';
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "attachment_key" TEXT;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "attachment_name" TEXT;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "attachment_mime" TEXT;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "attachment_size" INTEGER;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "attachment_duration_ms" INTEGER;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "attachment_width" INTEGER;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "attachment_height" INTEGER;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "reply_to_id" TEXT;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "reactions" JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Body may be empty when the message carries a file or was deleted for everyone.
ALTER TABLE "chat_messages" DROP CONSTRAINT IF EXISTS "chat_messages_body_check";
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_body_check"
  CHECK (length("body") <= 4000 AND (length("body") >= 1 OR "attachment_key" IS NOT NULL OR "deleted_at" IS NOT NULL));
