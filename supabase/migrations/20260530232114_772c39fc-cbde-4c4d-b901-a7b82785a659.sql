ALTER TABLE public.budgets
  ADD COLUMN IF NOT EXISTS budget_type text NOT NULL DEFAULT 'flex',
  ADD COLUMN IF NOT EXISTS rollover_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.budgets DROP CONSTRAINT IF EXISTS budgets_type_check;
ALTER TABLE public.budgets ADD CONSTRAINT budgets_type_check
  CHECK (budget_type IN ('fixed','flex','annual'));

CREATE UNIQUE INDEX IF NOT EXISTS budgets_user_cat_month_uniq
  ON public.budgets(user_id, category_id, month);