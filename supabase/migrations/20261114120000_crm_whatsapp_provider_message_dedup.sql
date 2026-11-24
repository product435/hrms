-- WRITTEN FOR REVIEW ONLY. NOT EXECUTED.
--
-- Adds a database-level duplicate-event guard for incoming WhatsApp webhook
-- events, on top of the application-level check the whatsapp-webhook Edge
-- Function already does. provider_message_id is WhatsApp's own message id
-- and is globally unique per message; a partial unique index (ignoring
-- rows where it is null, since outbound messages can still be recorded
-- without one if the provider accepted the send but never returned an id)
-- means a retried webhook delivery can never insert the same message twice
-- even under concurrent requests, which the Edge Function's own
-- check-then-insert cannot fully guarantee on its own.
--
-- Safe to run on the existing table: does not alter any existing row,
-- column, trigger or RLS policy; only adds an index. Will fail only if
-- duplicate non-null provider_message_id values already exist, which the
-- current schema's application code never produces.

create unique index if not exists idx_crm_whatsapp_messages_provider_message_id
  on public.crm_whatsapp_messages (provider_message_id)
  where provider_message_id is not null;
