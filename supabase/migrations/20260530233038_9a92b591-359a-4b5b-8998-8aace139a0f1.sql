CREATE TABLE public.goals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  target_amount_usd NUMERIC NOT NULL,
  current_amount_usd NUMERIC NOT NULL DEFAULT 0,
  monthly_contribution_usd NUMERIC NOT NULL DEFAULT 0,
  target_date DATE,
  color TEXT NOT NULL DEFAULT '#10b981',
  icon TEXT,
  account_id UUID,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.goals TO authenticated;
GRANT ALL ON public.goals TO service_role;

ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own goals all"
  ON public.goals
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER goals_touch_updated_at
  BEFORE UPDATE ON public.goals
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX idx_goals_user ON public.goals(user_id);