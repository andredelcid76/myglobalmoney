// O saldo inicial das contas é armazenado em moeda nativa, mas as agregações
// de patrimônio/projeção somam em USD. Estes helpers fazem a conversão usando
// a cotação USD→BRL mais recente cacheada em exchange_rates.

export async function getLatestUsdBrlRate(supabase: any): Promise<number | null> {
  const { data } = await supabase
    .from("exchange_rates")
    .select("rate")
    .eq("base", "USD")
    .eq("quote", "BRL")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? Number(data.rate) : null;
}

export function initialBalanceUsd(
  account: { currency?: string | null; initial_balance?: number | string | null },
  usdBrl: number | null,
): number {
  const bal = Number(account.initial_balance ?? 0);
  if ((account.currency ?? "USD") === "USD") return bal;
  return usdBrl && usdBrl > 0 ? bal / usdBrl : bal;
}
