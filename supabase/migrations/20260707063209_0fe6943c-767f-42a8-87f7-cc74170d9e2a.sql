GRANT INSERT, UPDATE ON public.exchange_rates TO authenticated;
CREATE POLICY "rates write authenticated" ON public.exchange_rates FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "rates update authenticated" ON public.exchange_rates FOR UPDATE TO authenticated USING (true) WITH CHECK (true);