ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS budget_group text NOT NULL DEFAULT 'variavel';
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_budget_group_check;
ALTER TABLE public.categories ADD CONSTRAINT categories_budget_group_check CHECK (budget_group IN ('renda','fixa','variavel','poupanca'));
UPDATE public.categories SET budget_group = 'renda' WHERE is_income = true AND budget_group = 'variavel';
CREATE INDEX IF NOT EXISTS idx_categories_budget_group ON public.categories(user_id, budget_group);