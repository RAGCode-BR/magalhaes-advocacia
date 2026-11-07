BEGIN;

CREATE TABLE public.office_finance_services (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  description text CHECK (length(description)<=2000),
  price_cents integer NOT NULL CHECK (price_cents>=0),
  active boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX office_finance_service_name ON public.office_finance_services(lower(trim(name)));

CREATE TABLE public.office_finance_orders (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('service','purchase')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_progress','completed','cancelled')),
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 200),
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  process_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  supplier text CHECK (length(supplier)<=160),
  category text NOT NULL CHECK (length(trim(category)) BETWEEN 1 AND 100),
  cost_center text CHECK (length(cost_center)<=160),
  notes text CHECK (length(notes)<=4000),
  total_cents integer NOT NULL CHECK (total_cents>0),
  discount_cents integer NOT NULL DEFAULT 0 CHECK (discount_cents>=0),
  installments integer NOT NULL CHECK (installments BETWEEN 1 AND 120),
  competence_date date NOT NULL,
  first_due date NOT NULL,
  start_date date NOT NULL,
  expected_date date NOT NULL,
  responsible text CHECK (length(responsible)<=160),
  generated_at timestamptz,
  cancellation_reason text CHECK (length(cancellation_reason)<=500),
  created_by uuid NOT NULL DEFAULT public.office_finance_uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expected_date>=start_date)
);

CREATE TABLE public.office_finance_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.office_finance_orders(id) ON DELETE CASCADE,
  service_id uuid REFERENCES public.office_finance_services(id) ON DELETE SET NULL,
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 200),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 10000),
  unit_cents integer NOT NULL CHECK (unit_cents>=0)
);
CREATE INDEX office_finance_order_items_order ON public.office_finance_order_items(order_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['office_finance_services','office_finance_orders','office_finance_order_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, authenticated',t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
    EXECUTE format('CREATE POLICY admin_read ON public.%I FOR SELECT TO authenticated USING(public.has_role(public.office_finance_uid(),''admin''))',t);
    EXECUTE format('CREATE TRIGGER finance_audit AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.office_finance_audit()',t);
  END LOOP;
END $$;

-- Draft item replacements must retain the removed rows in the audit history.
CREATE OR REPLACE FUNCTION public.office_finance_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO public.office_finance_history(entity_id,entity_type,action,before_data,after_data)
  VALUES(
    CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END,
    TG_TABLE_NAME,TG_OP,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END
  );
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER finance_audit_delete AFTER DELETE ON public.office_finance_order_items
  FOR EACH ROW EXECUTE FUNCTION public.office_finance_audit();

CREATE FUNCTION public.office_finance_save_service(target uuid,data jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM public.office_finance_require_admin();
  INSERT INTO public.office_finance_services(id,name,description,price_cents,active)
  VALUES(target,trim(data->>'name'),nullif(trim(data->>'description'),''),(data->>'price_cents')::integer,coalesce((data->>'active')::boolean,true))
  ON CONFLICT(id) DO UPDATE SET
    name=EXCLUDED.name,description=EXCLUDED.description,price_cents=EXCLUDED.price_cents,active=EXCLUDED.active;
END $$;

CREATE FUNCTION public.office_finance_save_order(target uuid,order_kind text,data jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  existing public.office_finance_orders;
  c uuid:=nullif(data->>'client_id','')::uuid;
  p uuid:=nullif(data->>'process_id','')::uuid;
  supplier_name text:=nullif(trim(data->>'supplier'),'');
  discount integer:=coalesce((data->>'discount_cents')::integer,0);
  parts integer:=(data->>'installments')::integer;
  items jsonb:=data->'items';
  item jsonb;
  line_description text;
  quantity integer;
  unit_price integer;
  service uuid;
  gross bigint:=0;
  total bigint;
BEGIN
  PERFORM public.office_finance_require_admin();
  IF target IS NULL THEN RAISE EXCEPTION 'Identificador do pedido inválido.'; END IF;
  IF order_kind IS NULL OR order_kind NOT IN ('service','purchase') THEN RAISE EXCEPTION 'Tipo de pedido inválido.'; END IF;
  -- Serialize two requests creating the same draft, including before its row exists.
  PERFORM pg_advisory_xact_lock(hashtextextended(target::text,19351));
  SELECT * INTO existing FROM public.office_finance_orders WHERE id=target FOR UPDATE;
  IF FOUND THEN
    IF existing.kind<>order_kind THEN RAISE EXCEPTION 'O tipo do pedido não pode ser alterado.'; END IF;
    IF existing.generated_at IS NOT NULL THEN RETURN; END IF;
    IF existing.status<>'draft' THEN RAISE EXCEPTION 'Somente pedidos em rascunho podem ser editados.'; END IF;
  END IF;
  IF order_kind='service' AND c IS NULL THEN RAISE EXCEPTION 'Selecione o cliente do serviço.'; END IF;
  IF c IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.clients WHERE id=c) THEN RAISE EXCEPTION 'Cliente indisponível.'; END IF;
  IF p IS NOT NULL AND (c IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.tasks WHERE id=p AND client_id=c AND deleted_at IS NULL
  )) THEN RAISE EXCEPTION 'O processo deve pertencer ao cliente.'; END IF;
  IF order_kind='purchase' AND supplier_name IS NULL THEN RAISE EXCEPTION 'Informe o fornecedor da compra.'; END IF;
  IF (data->>'start_date')::date IS NULL OR (data->>'expected_date')::date IS NULL
    OR (data->>'expected_date')::date<(data->>'start_date')::date THEN
    RAISE EXCEPTION 'A previsão de entrega deve ser igual ou posterior ao início.';
  END IF;
  IF jsonb_typeof(items) IS DISTINCT FROM 'array' OR jsonb_array_length(items) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Adicione de 1 a 200 itens ao pedido.';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
    line_description:=trim(item->>'description');
    quantity:=(item->>'quantity')::integer;
    unit_price:=(item->>'unit_cents')::integer;
    service:=nullif(item->>'service_id','')::uuid;
    IF line_description IS NULL OR length(line_description) NOT BETWEEN 1 AND 200
      OR quantity IS NULL OR quantity NOT BETWEEN 1 AND 10000 OR unit_price IS NULL OR unit_price<0 THEN
      RAISE EXCEPTION 'Revise a descrição, a quantidade e o preço de cada item.';
    END IF;
    IF service IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.office_finance_services WHERE id=service) THEN
      RAISE EXCEPTION 'Serviço do catálogo indisponível.';
    END IF;
    gross:=gross+quantity::bigint*unit_price;
  END LOOP;
  total:=gross-discount;
  IF discount<0 OR total NOT BETWEEN 1 AND 2147483647 THEN RAISE EXCEPTION 'O desconto deve ser menor que o total e o valor líquido deve ser positivo.'; END IF;
  IF parts IS NULL OR parts NOT BETWEEN 1 AND 120 OR parts>total THEN RAISE EXCEPTION 'Informe de 1 a 120 parcelas com pelo menos um centavo cada.'; END IF;
  IF data ? 'total_cents' AND (data->>'total_cents')::bigint IS DISTINCT FROM total THEN
    RAISE EXCEPTION 'O total informado não corresponde aos itens e ao desconto.';
  END IF;

  INSERT INTO public.office_finance_orders(id,kind,description,client_id,process_id,supplier,category,cost_center,notes,total_cents,discount_cents,installments,competence_date,first_due,start_date,expected_date,responsible)
  VALUES(target,order_kind,trim(data->>'description'),c,p,supplier_name,trim(data->>'category'),nullif(trim(data->>'cost_center'),''),
    nullif(trim(data->>'notes'),''),total::integer,discount,parts,(data->>'competence_date')::date,(data->>'first_due')::date,
    (data->>'start_date')::date,(data->>'expected_date')::date,nullif(trim(data->>'responsible'),''))
  ON CONFLICT(id) DO UPDATE SET description=EXCLUDED.description,client_id=EXCLUDED.client_id,process_id=EXCLUDED.process_id,
    supplier=EXCLUDED.supplier,category=EXCLUDED.category,cost_center=EXCLUDED.cost_center,notes=EXCLUDED.notes,
    total_cents=EXCLUDED.total_cents,discount_cents=EXCLUDED.discount_cents,installments=EXCLUDED.installments,
    competence_date=EXCLUDED.competence_date,first_due=EXCLUDED.first_due,
    start_date=EXCLUDED.start_date,expected_date=EXCLUDED.expected_date,responsible=EXCLUDED.responsible,updated_at=now();
  DELETE FROM public.office_finance_order_items WHERE order_id=target;
  INSERT INTO public.office_finance_order_items(order_id,service_id,description,quantity,unit_cents)
  SELECT target,nullif(value->>'service_id','')::uuid,trim(value->>'description'),(value->>'quantity')::integer,(value->>'unit_cents')::integer
  FROM jsonb_array_elements(items);
END $$;

CREATE FUNCTION public.office_finance_order_action(target uuid,action text,reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.office_finance_orders; i integer; amount integer;
BEGIN
  PERFORM public.office_finance_require_admin();
  SELECT * INTO STRICT o FROM public.office_finance_orders WHERE id=target FOR UPDATE;
  IF action='start' AND o.status IN ('in_progress','completed') THEN RETURN; END IF;
  IF action='start' AND o.status='draft' THEN
    UPDATE public.office_finance_orders SET status='in_progress',updated_at=now() WHERE id=target;
    RETURN;
  END IF;
  IF action='complete' AND o.status='completed' THEN RETURN; END IF;
  IF action='complete' AND o.status='in_progress' THEN
    UPDATE public.office_finance_orders SET status='completed',updated_at=now() WHERE id=target;
    RETURN;
  END IF;
  IF action='generate' THEN
    IF o.generated_at IS NOT NULL THEN RETURN; END IF;
    IF o.status<>'completed' THEN RAISE EXCEPTION 'Conclua o pedido antes de gerar o financeiro.'; END IF;
    IF o.kind='service' AND o.client_id IS NULL THEN RAISE EXCEPTION 'O cliente não está mais disponível.'; END IF;
    IF o.process_id IS NOT NULL AND (o.client_id IS NULL OR NOT EXISTS(
      SELECT 1 FROM public.tasks WHERE id=o.process_id AND client_id=o.client_id AND deleted_at IS NULL
    )) THEN RAISE EXCEPTION 'O processo não está mais disponível para este cliente.'; END IF;
    FOR i IN 0..o.installments-1 LOOP
      amount:=o.total_cents/o.installments+CASE WHEN i<o.total_cents%o.installments THEN 1 ELSE 0 END;
      INSERT INTO public.office_finance_entries(group_id,installment,installment_count,kind,description,category,cost_center,supplier,notes,client_id,process_id,competence_date,due_date,amount_cents)
      VALUES(o.id,i+1,o.installments,CASE o.kind WHEN 'service' THEN 'income' ELSE 'expense' END,
        o.description,o.category,o.cost_center,o.supplier,o.notes,o.client_id,o.process_id,o.competence_date,
        (o.first_due+make_interval(months=>i))::date,amount);
    END LOOP;
    UPDATE public.office_finance_orders SET generated_at=now(),updated_at=now() WHERE id=target;
    RETURN;
  END IF;
  IF action='cancel' THEN
    IF o.status='cancelled' THEN RETURN; END IF;
    IF nullif(trim(reason),'') IS NULL OR length(reason)>500 THEN RAISE EXCEPTION 'Informe o motivo do cancelamento, com até 500 caracteres.'; END IF;
    PERFORM id FROM public.office_finance_entries WHERE group_id=target ORDER BY id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM public.office_finance_entries WHERE group_id=target AND settled_cents>0) THEN
      RAISE EXCEPTION 'Estorne as baixas antes de cancelar o pedido.';
    END IF;
    UPDATE public.office_finance_entries SET cancelled_at=now(),cancellation_reason=reason,updated_at=now()
    WHERE group_id=target AND cancelled_at IS NULL;
    UPDATE public.office_finance_orders SET status='cancelled',cancellation_reason=reason,updated_at=now() WHERE id=target;
    RETURN;
  END IF;
  RAISE EXCEPTION 'Operação indisponível para esta situação.';
END $$;

REVOKE ALL ON FUNCTION public.office_finance_save_service(uuid,jsonb),
  public.office_finance_save_order(uuid,text,jsonb),public.office_finance_order_action(uuid,text,text)
  FROM PUBLIC,authenticated;
GRANT EXECUTE ON FUNCTION public.office_finance_save_service(uuid,jsonb),
  public.office_finance_save_order(uuid,text,jsonb),public.office_finance_order_action(uuid,text,text)
  TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
