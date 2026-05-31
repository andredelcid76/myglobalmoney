ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS split_group_id uuid;
CREATE INDEX IF NOT EXISTS idx_transactions_split_group ON public.transactions(split_group_id) WHERE split_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_tags ON public.transactions USING GIN(tags);