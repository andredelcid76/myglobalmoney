
CREATE TABLE public.categorization_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  pattern TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'contains',
  category_id UUID NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.categorization_rules TO authenticated;
GRANT ALL ON public.categorization_rules TO service_role;

ALTER TABLE public.categorization_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own rules all"
  ON public.categorization_rules
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_categorization_rules_user ON public.categorization_rules(user_id, priority DESC);

CREATE TRIGGER trg_categorization_rules_updated_at
BEFORE UPDATE ON public.categorization_rules
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
