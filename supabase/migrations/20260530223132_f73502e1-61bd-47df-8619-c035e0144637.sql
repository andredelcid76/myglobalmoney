
-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  default_currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile select" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Accounts
CREATE TYPE public.account_type AS ENUM ('checking','savings','credit_card','cash','investment','other');

CREATE TABLE public.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type public.account_type NOT NULL DEFAULT 'checking',
  currency TEXT NOT NULL DEFAULT 'USD',
  initial_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  institution TEXT,
  color TEXT DEFAULT '#4f46e5',
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX accounts_user_idx ON public.accounts(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounts TO authenticated;
GRANT ALL ON public.accounts TO service_role;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own accounts all" ON public.accounts FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Categories (with subcategories via parent_id)
CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES public.categories(id) ON DELETE CASCADE,
  color TEXT DEFAULT '#4f46e5',
  icon TEXT,
  is_income BOOLEAN NOT NULL DEFAULT false,
  is_transfer BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX categories_user_idx ON public.categories(user_id);
CREATE INDEX categories_parent_idx ON public.categories(parent_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT ALL ON public.categories TO service_role;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own categories all" ON public.categories FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Transactions
CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  merchant TEXT NOT NULL,
  original_statement TEXT,
  notes TEXT,
  amount NUMERIC(14,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  amount_usd NUMERIC(14,2) NOT NULL,
  exchange_rate NUMERIC(14,6),
  tags TEXT[],
  is_transfer BOOLEAN NOT NULL DEFAULT false,
  is_pending BOOLEAN NOT NULL DEFAULT false,
  external_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tx_user_date_idx ON public.transactions(user_id, date DESC);
CREATE INDEX tx_account_idx ON public.transactions(account_id);
CREATE INDEX tx_category_idx ON public.transactions(category_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO authenticated;
GRANT ALL ON public.transactions TO service_role;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own tx all" ON public.transactions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Budgets (monthly per category, in USD)
CREATE TABLE public.budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  month DATE NOT NULL, -- first day of month
  amount_usd NUMERIC(14,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, category_id, month)
);
CREATE INDEX budgets_user_month_idx ON public.budgets(user_id, month);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.budgets TO authenticated;
GRANT ALL ON public.budgets TO service_role;
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own budgets all" ON public.budgets FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Exchange rates (shared cache)
CREATE TABLE public.exchange_rates (
  date DATE NOT NULL,
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  rate NUMERIC(14,6) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (date, base, quote)
);
GRANT SELECT ON public.exchange_rates TO authenticated, anon;
GRANT ALL ON public.exchange_rates TO service_role;
ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rates read" ON public.exchange_rates FOR SELECT TO authenticated, anon USING (true);

-- Trigger to auto-create profile and seed default data on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cat_food UUID; cat_trans UUID; cat_home UUID; cat_shop UUID; cat_health UUID;
  cat_subs UUID; cat_inc UUID; cat_tr UUID; cat_other UUID;
BEGIN
  INSERT INTO public.profiles (id, display_name) VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)));

  -- Default accounts
  INSERT INTO public.accounts (user_id, name, type, currency, institution, color) VALUES
    (NEW.id, 'Bank of America Checking', 'checking', 'USD', 'Bank of America', '#dc2626'),
    (NEW.id, 'BoA Credit Card', 'credit_card', 'USD', 'Bank of America', '#ef4444'),
    (NEW.id, 'Nubank BRL', 'checking', 'BRL', 'Nubank', '#8a05be'),
    (NEW.id, 'Nubank (histórico USD)', 'checking', 'USD', 'Nubank', '#a855f7');

  -- Seed top-level categories
  INSERT INTO public.categories (user_id, name, color, is_income) VALUES (NEW.id,'Income','#10b981',true) RETURNING id INTO cat_inc;
  INSERT INTO public.categories (user_id, name, color, is_transfer) VALUES (NEW.id,'Transfer','#64748b',true) RETURNING id INTO cat_tr;
  INSERT INTO public.categories (user_id, name, color) VALUES (NEW.id,'Food & Dining','#f59e0b') RETURNING id INTO cat_food;
  INSERT INTO public.categories (user_id, name, color) VALUES (NEW.id,'Transportation','#3b82f6') RETURNING id INTO cat_trans;
  INSERT INTO public.categories (user_id, name, color) VALUES (NEW.id,'Home','#84cc16') RETURNING id INTO cat_home;
  INSERT INTO public.categories (user_id, name, color) VALUES (NEW.id,'Shopping','#ec4899') RETURNING id INTO cat_shop;
  INSERT INTO public.categories (user_id, name, color) VALUES (NEW.id,'Health','#06b6d4') RETURNING id INTO cat_health;
  INSERT INTO public.categories (user_id, name, color) VALUES (NEW.id,'Subscriptions','#a78bfa') RETURNING id INTO cat_subs;
  INSERT INTO public.categories (user_id, name, color) VALUES (NEW.id,'Other','#94a3b8') RETURNING id INTO cat_other;

  -- Subcategories matching Monarch's common ones
  INSERT INTO public.categories (user_id, name, parent_id, color) VALUES
    (NEW.id,'Groceries',cat_food,'#f59e0b'),
    (NEW.id,'Restaurants & Bars',cat_food,'#f97316'),
    (NEW.id,'Coffee Shops',cat_food,'#d97706'),
    (NEW.id,'Fast Food',cat_food,'#fb923c'),
    (NEW.id,'Gas',cat_trans,'#3b82f6'),
    (NEW.id,'Parking & Tolls',cat_trans,'#60a5fa'),
    (NEW.id,'Auto Maintenance',cat_trans,'#2563eb'),
    (NEW.id,'Public Transit',cat_trans,'#1d4ed8'),
    (NEW.id,'Rent / Mortgage',cat_home,'#84cc16'),
    (NEW.id,'Utilities',cat_home,'#65a30d'),
    (NEW.id,'Internet & Phone',cat_home,'#4d7c0f'),
    (NEW.id,'Furniture & Housewares',cat_home,'#a3e635'),
    (NEW.id,'Home Improvement',cat_home,'#a3e635'),
    (NEW.id,'Insurance',cat_home,'#22c55e'),
    (NEW.id,'Clothing',cat_shop,'#ec4899'),
    (NEW.id,'Electronics',cat_shop,'#db2777'),
    (NEW.id,'Online Shopping',cat_shop,'#f472b6'),
    (NEW.id,'Medical',cat_health,'#06b6d4'),
    (NEW.id,'Pharmacy',cat_health,'#0891b2'),
    (NEW.id,'Fitness',cat_health,'#0e7490'),
    (NEW.id,'Paychecks',cat_inc,'#10b981'),
    (NEW.id,'Interest',cat_inc,'#34d399'),
    (NEW.id,'Refunds',cat_inc,'#6ee7b7'),
    (NEW.id,'Loan Repayment',cat_other,'#94a3b8'),
    (NEW.id,'Fees',cat_other,'#64748b'),
    (NEW.id,'Travel',cat_other,'#0ea5e9'),
    (NEW.id,'Entertainment',cat_other,'#a855f7'),
    (NEW.id,'Pets',cat_other,'#f472b6'),
    (NEW.id,'Gifts & Donations',cat_other,'#fb7185'),
    (NEW.id,'Taxes',cat_other,'#71717a'),
    (NEW.id,'Education',cat_other,'#0ea5e9'),
    (NEW.id,'Personal Care',cat_other,'#fb7185'),
    (NEW.id,'Cash & ATM',cat_other,'#94a3b8'),
    (NEW.id,'Uncategorized',cat_other,'#475569');

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER tx_touch BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER acc_touch BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER bud_touch BEFORE UPDATE ON public.budgets FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER prof_touch BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
