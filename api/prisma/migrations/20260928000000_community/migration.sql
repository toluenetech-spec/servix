-- Additive; apply manually with the existing controlled migration runner after review.
CREATE TABLE "community_connections" (
 "id" TEXT PRIMARY KEY, "pair_key" TEXT NOT NULL UNIQUE,
 "requester_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
 "recipient_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
 "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','accepted','declined','removed','blocked')),
 "blocked_by_id" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
 CHECK ("requester_id" <> "recipient_id"), CHECK ("blocked_by_id" IS NULL OR "blocked_by_id" IN ("requester_id", "recipient_id"))
);
CREATE INDEX "community_connections_requester_id_status_idx" ON "community_connections"("requester_id","status");
CREATE INDEX "community_connections_recipient_id_status_idx" ON "community_connections"("recipient_id","status");
CREATE TABLE "chat_threads" (
 "id" TEXT PRIMARY KEY,
 "participant_a_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
 "participant_b_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
 "booking_id" TEXT UNIQUE REFERENCES "bookings"("id") ON DELETE RESTRICT,
 "connection_id" TEXT UNIQUE REFERENCES "community_connections"("id") ON DELETE RESTRICT,
 "read_at_a" TIMESTAMP(3), "read_at_b" TIMESTAMP(3),
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
 CHECK ("participant_a_id" <> "participant_b_id"), CHECK (("booking_id" IS NULL) <> ("connection_id" IS NULL))
);
CREATE INDEX "chat_threads_participant_a_id_updated_at_idx" ON "chat_threads"("participant_a_id","updated_at");
CREATE INDEX "chat_threads_participant_b_id_updated_at_idx" ON "chat_threads"("participant_b_id","updated_at");
CREATE TABLE "chat_messages" (
 "id" TEXT PRIMARY KEY, "thread_id" TEXT NOT NULL REFERENCES "chat_threads"("id") ON DELETE CASCADE,
 "sender_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
 "client_id" TEXT NOT NULL, "body" TEXT NOT NULL CHECK (length("body") BETWEEN 1 AND 4000),
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("sender_id", "client_id")
);
CREATE INDEX "chat_messages_thread_id_created_at_id_idx" ON "chat_messages"("thread_id","created_at","id");
