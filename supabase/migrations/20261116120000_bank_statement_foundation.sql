-- Local preparation for the Sicoob connector. Apply after the finance migrations.
-- Bank records are evidence from the provider, independent of manual ledger entries.
-- The browser can read them as an administrator. Import writes require a future
-- dedicated backend role, granted after the bank's authentication flow is validated.
BEGIN;

CREATE TABLE public.office_bank_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE REFERENCES public.office_finance_accounts(id),
  bank_code text NOT NULL DEFAULT '756' CHECK (bank_code = '756'),
  product text NOT NULL CHECK (product IN ('checking', 'rdc')),
  enabled boolean NOT NULL DEFAULT false,
  last_success_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.office_bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.office_bank_connections(id),
  -- Use the provider's stable transaction ID. Date + value is not unique.
  external_id text NOT NULL CHECK (length(trim(external_id)) BETWEEN 1 AND 256),
  booked_on date NOT NULL,
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 1000),
  -- Positive = credit; negative = debit. Integer cents, safe for JavaScript.
  amount_cents bigint NOT NULL CHECK (
    amount_cents <> 0 AND amount_cents BETWEEN -9007199254740991 AND 9007199254740991
  ),
  currency text NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  observed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, external_id)
);
CREATE INDEX office_bank_transactions_period
  ON public.office_bank_transactions(connection_id, booked_on DESC, id DESC);

CREATE TABLE public.office_bank_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.office_bank_connections(id),
  kind text NOT NULL CHECK (kind IN ('ledger', 'available', 'investment_gross', 'investment_net')),
  amount_cents bigint NOT NULL CHECK (
    amount_cents BETWEEN -9007199254740991 AND 9007199254740991
  ),
  currency text NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  observed_at timestamptz NOT NULL,
  UNIQUE (connection_id, kind, observed_at)
);

DO $$
DECLARE relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'office_bank_connections', 'office_bank_transactions', 'office_bank_balances'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, authenticated', relation_name);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', relation_name);
    EXECUTE format(
      'CREATE POLICY bank_admin_read ON public.%I FOR SELECT TO authenticated
       USING (public.has_role(public.office_finance_uid(), ''admin''))', relation_name
    );
  END LOOP;
END $$;

-- Supports reconciliation by account/date and matching open items by amount.
CREATE INDEX office_finance_settlements_account_date
  ON public.office_finance_settlements(account_id, settled_on, id)
  WHERE reversed_at IS NULL;
CREATE INDEX office_finance_entries_open_amount
  ON public.office_finance_entries(kind, (amount_cents - settled_cents), due_date, id)
  WHERE cancelled_at IS NULL AND settled_cents < amount_cents;

COMMIT;
