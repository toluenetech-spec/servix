-- Servix AI answer feedback (additive; no existing table or row is touched).
CREATE TABLE "ai_feedback" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "department" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "comment" TEXT,
    "prompt" TEXT,
    "answer" TEXT,
    "model_alias" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_feedback_created_at_idx" ON "ai_feedback"("created_at");
CREATE INDEX "ai_feedback_rating_created_at_idx" ON "ai_feedback"("rating", "created_at");
CREATE INDEX "ai_feedback_user_id_created_at_idx" ON "ai_feedback"("user_id", "created_at");

ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
