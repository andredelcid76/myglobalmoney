import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Fetches USD->BRL rate for a given date. Caches in exchange_rates table.
// Source: Frankfurter (ECB) — free, no key.
async function fetchRate(date: string): Promise<number> {
  const url = `https://api.frankfurter.dev/v1/${date}?base=USD&symbols=BRL`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FX fetch failed: ${res.status}`);
  const json: { rates?: { BRL?: number } } = await res.json();
  if (!json.rates?.BRL) throw new Error("No BRL rate in response");
  return json.rates.BRL;
}

export const getUsdBrlRate = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Frankfurter returns latest available business day if weekend
    const { data: cached } = await supabaseAdmin
      .from("exchange_rates")
      .select("rate")
      .eq("date", data.date)
      .eq("base", "USD")
      .eq("quote", "BRL")
      .maybeSingle();
    if (cached) return { rate: Number(cached.rate), cached: true };

    try {
      const rate = await fetchRate(data.date);
      await supabaseAdmin.from("exchange_rates").upsert({
        date: data.date, base: "USD", quote: "BRL", rate,
      });
      return { rate, cached: false };
    } catch (e) {
      // fallback: latest cached
      const { data: latest } = await supabaseAdmin
        .from("exchange_rates")
        .select("rate")
        .eq("base", "USD").eq("quote", "BRL")
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest) return { rate: Number(latest.rate), cached: true };
      throw e;
    }
  });

export const getLatestUsdBrl = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const today = new Date().toISOString().slice(0, 10);
  const { data: cached } = await supabaseAdmin
    .from("exchange_rates")
    .select("date, rate")
    .eq("base", "USD").eq("quote", "BRL")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  // refresh once per day
  if (cached && cached.date === today) return { rate: Number(cached.rate), date: cached.date };

  try {
    const url = `https://api.frankfurter.dev/v1/latest?base=USD&symbols=BRL`;
    const res = await fetch(url);
    const json: { date?: string; rates?: { BRL?: number } } = await res.json();
    if (json.rates?.BRL && json.date) {
      await supabaseAdmin.from("exchange_rates").upsert({
        date: json.date, base: "USD", quote: "BRL", rate: json.rates.BRL,
      });
      return { rate: json.rates.BRL, date: json.date };
    }
  } catch {}
  if (cached) return { rate: Number(cached.rate), date: cached.date };
  throw new Error("Cotação USD/BRL indisponível (sem cache e API de câmbio fora do ar) — tente novamente mais tarde");
});