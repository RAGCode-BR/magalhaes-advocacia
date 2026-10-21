-- The Magalhães installation has only Consultoria. The inherited mirror rule
-- inserted into a missing Marketing workspace, which the assignment trigger
-- redirected back into Consultoria and produced a duplicate client.
DROP TRIGGER IF EXISTS trg_sync_consultoria_client_to_marketing ON public.clients;
