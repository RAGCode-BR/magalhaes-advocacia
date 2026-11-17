-- Finite recurring schedules are inserted atomically using the existing unique
-- (group_id, installment) key. Keep permissions and existing imported entries unchanged.
ALTER TABLE public.office_finance_entries
  ADD COLUMN IF NOT EXISTS recurrence_frequency text
  CHECK (recurrence_frequency IN ('weekly','fortnightly','monthly','quarterly','yearly'));
-- Same existing admin-only RLS policy; allow the new metadata on creation only.
GRANT INSERT (recurrence_frequency) ON public.office_finance_entries TO authenticated;
