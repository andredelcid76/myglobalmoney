## Escopo

Três frentes, na ordem em que vou entregar:

1. **Transações — visão extrato com saldo acumulado** (nova, foi o seu pedido extra)
2. **Orçamento — versão Pro** (grade anual, grupos, rollover, alertas)
3. **Projeções — fluxo de caixa completo** (por conta, com metas/parcelas, gráfico + tabela)

---

### 1. Transações — visão extrato

Adicionar um **toggle de modo** na página atual: `Lista` (atual) | `Extrato`.

No modo Extrato:
- Filtro de **período** (Hoje, 7d, 30d, Este mês, Mês anterior, Customizado)
- Filtro de **agrupamento**: Diário / Semanal / Mensal
- Filtro por **conta** (uma ou todas — quando "todas" o saldo é a soma em USD)
- Tabela: Data | Lançamentos do período | Entradas | Saídas | Saldo do período | **Saldo acumulado**
- Linha do período expansível → mostra cada transação dentro daquele dia/semana/mês
- Saldo inicial = saldo da conta na data anterior ao primeiro período visível (calculado a partir de `initial_balance` + todas as transações até a data)
- Coluna de saldo acumulado em verde/vermelho conforme positivo/negativo

### 2. Orçamento Pro

Reescrever `/budgets` com 3 abas:

**Aba "Mensal"** (visão atual, melhorada):
- Categorias agrupadas em **buckets**: Renda · Despesa Fixa · Variável · Poupança/Metas
- Cada linha mostra: Orçado · Realizado · % consumido · barra · **ritmo do mês** (badge "20% à frente" / "no ritmo" / "atrasado") com base no dia do mês
- Alerta de **estouro** (linha vermelha quando realizado > orçado) e de **risco** (>80% do orçado mas ainda no meio do mês)
- Totais por bucket + total geral (entrada − saída esperada)

**Aba "Anual"** (12 meses em grade):
- Tabela: linha = categoria, coluna = jan…dez, célula editável (clica → input inline)
- Coluna de **média** dos últimos 6 meses ao lado do nome
- Linha de total por mês no rodapé
- Botão "Replicar do mês X para todos" e "Aplicar média histórica"

**Aba "Rollover"**:
- Lista categorias com `rollover_enabled` toggle
- Mostra saldo carregado do mês anterior (sobra positiva ou déficit negativo) que é somado ao orçado do mês atual
- A lógica de rollover passa a ser aplicada na aba Mensal automaticamente quando o flag está ligado

### 3. Projeções — fluxo completo

Reescrever `/projections` com:

- Filtro de **horizonte**: 3m / 6m / 12m
- Filtro de **granularidade**: Semanal / Mensal / Trimestral
- **Gráfico de área** com saldo acumulado projetado (linha por conta + linha total)
- **Cards** por conta com: saldo atual · saldo projetado no fim do horizonte · alerta se for negativar (e quando)
- **Tabela detalhada** por período mostrando: entradas previstas | saídas previstas | saldo do período | saldo acumulado
- Cada linha do período expansível para ver as fontes:
  - Recorrências (salário, contas fixas)
  - Orçamento variável (médias mensais por categoria)
  - **Metas** (contribuição mensal de cada meta ativa, descontada da conta vinculada)
  - **Faturas futuras de cartão** (fechamento já feito → vence na data Y)
- Premissas editáveis: "Ajustar renda em X%", "Ajustar despesa em Y%" (override simples, sem virar página de cenários)

---

## Detalhes técnicos

### Banco
- Nenhuma mudança de schema obrigatória — `budgets.rollover_enabled` e `budgets.budget_type` já existem; vou usar `budget_type` como bucket (`fixed`/`flex`/`annual` + adicionar `income` e `savings` via constraint check existente — se a constraint não permitir, faço migration pra trocar por texto livre validado no app).
- Para agrupamento de categorias em buckets, vou usar a coluna `is_income` (já existe) e uma nova coluna opcional `budget_group` em `categories` (text, default 'variable') — **1 migration pequena**.

### Server functions (novas em `src/lib/finance.functions.ts` e `src/lib/projections.functions.ts`)
- `getLedgerView({ accountId?, from, to, granularity })` → períodos agregados + saldo acumulado
- `getBudgetMonthlyPro({ month })` → orçado + realizado + rollover acumulado + ritmo
- `getBudgetYearlyGrid({ year })` → matriz categoria × mês
- `upsertCategoryGroup({ id, budget_group })`
- `getCashflowProjection({ months, granularity })` → série por conta + por categoria + faturas de cartão + metas

### UI
- Páginas: `_app.transactions.tsx` (adicionar toggle/modo extrato), `_app.budgets.tsx` (3 abas com `Tabs`), `_app.projections.tsx` (cards + gráfico Recharts + tabela expansível)
- Componentes Recharts já estão no projeto

### Fora do escopo
- Cenários otimista/realista/pessimista (não foi pedido)
- Edição de transação no extrato (só visualização agrupada; edição continua na aba Lista)

---

## Entrega

Sigo a ordem 1 → 2 → 3 em uma única rodada e te aviso ao final. Posso começar?