
CREATE TABLE public.recurrences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  merchant_pattern TEXT,
  account_id UUID,
  category_id UUID,
  amount_usd NUMERIC NOT NULL,
  cadence TEXT NOT NULL CHECK (cadence IN ('weekly','biweekly','monthly','quarterly','yearly')),
  day_of_month INT,
  next_date DATE NOT NULL,
  is_income BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','auto')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurrences TO authenticated;
GRANT ALL ON public.recurrences TO service_role;

ALTER TABLE public.recurrences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own recurrences all" ON public.recurrences
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER recurrences_touch
  BEFORE UPDATE ON public.recurrences
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX idx_recurrences_user ON public.recurrences(user_id, is_active);
