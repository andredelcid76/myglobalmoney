DROP POLICY IF EXISTS "rates write authenticated" ON public.exchange_rates;
DROP POLICY IF EXISTS "rates update authenticated" ON public.exchange_rates;
REVOKE INSERT, UPDATE, DELETE ON public.exchange_rates FROM authenticated, anon;