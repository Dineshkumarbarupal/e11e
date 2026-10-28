ALTER TABLE webhook_tokens
  ADD COLUMN IF NOT EXISTS signature_secret_encrypted jsonb;
