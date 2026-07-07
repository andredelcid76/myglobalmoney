-- Trava de duplicatas de importação no banco: o mesmo external_id não entra
-- duas vezes na mesma conta (retry de rede / duplo clique / CSV reimportado).
-- Transações manuais têm external_id NULL e nunca conflitam entre si.
create unique index if not exists transactions_user_acct_ext_uniq
  on public.transactions (user_id, account_id, external_id);
