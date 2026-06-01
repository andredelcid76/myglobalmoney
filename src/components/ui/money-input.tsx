import * as React from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

type Currency = "USD" | "BRL" | string;

export interface MoneyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "size" | "type"> {
  value: number | string | null | undefined;
  onValueChange?: (value: number | null) => void;
  /** legacy text-event handler for drop-in replacement */
  onChange?: (e: { target: { value: string } }) => void;
  currency?: Currency;
  showSymbol?: boolean;
  showStepper?: boolean;
  allowNegative?: boolean;
  step?: number;
  size?: "sm" | "md" | "lg";
  align?: "left" | "right";
}

const symbolFor = (c?: Currency) =>
  c === "BRL" ? "R$" : c === "EUR" ? "€" : c === "GBP" ? "£" : "$";

const localeFor = (c?: Currency) => (c === "BRL" ? "pt-BR" : "en-US");

const decimalSepFor = (c?: Currency) => (c === "BRL" ? "," : ".");
const groupSepFor = (c?: Currency) => (c === "BRL" ? "." : ",");

function parseInput(raw: string, currency?: Currency): number | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (trimmed === "" || trimmed === "-") return null;
  const dec = decimalSepFor(currency);
  // strip group separators, normalize decimal to '.'
  let s = trimmed.replace(/\s/g, "");
  if (dec === ",") s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function formatDisplay(n: number, currency?: Currency, opts?: { compact?: boolean }) {
  return new Intl.NumberFormat(localeFor(currency), {
    minimumFractionDigits: opts?.compact ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** Format while typing: keep user's decimal portion intact, only group the integer side. */
function liveFormat(raw: string, currency?: Currency): string {
  if (raw === "" || raw === "-") return raw;
  const dec = decimalSepFor(currency);
  const grp = groupSepFor(currency);
  // remove group separators only
  const sanitized = raw.replace(new RegExp("\\" + grp, "g"), "");
  const neg = sanitized.startsWith("-") ? "-" : "";
  const body = neg ? sanitized.slice(1) : sanitized;
  const [intPartRaw, decPart] = body.split(dec);
  const intPart = (intPartRaw || "").replace(/\D/g, "");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, grp);
  if (decPart === undefined) return neg + (grouped || (intPartRaw === "" ? "" : "0"));
  return neg + (grouped || "0") + dec + decPart.replace(/\D/g, "").slice(0, 2);
}

const sizeClasses: Record<NonNullable<MoneyInputProps["size"]>, string> = {
  sm: "h-8 text-sm",
  md: "h-9 text-sm",
  lg: "h-11 text-base",
};

export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  (
    {
      value,
      onValueChange,
      onChange,
      currency = "USD",
      showSymbol = true,
      showStepper = false,
      allowNegative = false,
      step = 1,
      size = "md",
      align = "right",
      className,
      onBlur,
      onFocus,
      placeholder,
      disabled,
      ...rest
    },
    ref,
  ) => {
    const [focused, setFocused] = React.useState(false);
    const [draft, setDraft] = React.useState<string>(() => toEditable(value, currency));

    // sync external value when not editing
    React.useEffect(() => {
      if (!focused) setDraft(toEditable(value, currency));
    }, [value, currency, focused]);

    const emit = (next: number | null) => {
      onValueChange?.(next);
      onChange?.({ target: { value: next == null ? "" : String(next) } });
    };

    const bump = (dir: 1 | -1) => {
      const cur = parseInput(draft, currency) ?? 0;
      const next = Math.round((cur + dir * step) * 100) / 100;
      if (!allowNegative && next < 0) return;
      setDraft(liveFormat(next.toString().replace(".", decimalSepFor(currency)), currency));
      emit(next);
    };

    return (
      <div
        className={cn(
          "group relative flex items-stretch rounded-md border border-input bg-background shadow-sm transition-all",
          "focus-within:ring-2 focus-within:ring-ring/40 focus-within:border-ring",
          disabled && "opacity-60 cursor-not-allowed",
          sizeClasses[size],
          className,
        )}
      >
        {showSymbol && (
          <div
            className={cn(
              "flex items-center justify-center select-none border-r border-input bg-secondary/40 text-muted-foreground font-medium tabular-nums",
              size === "lg" ? "px-3 text-sm" : "px-2.5 text-xs",
            )}
            aria-hidden
          >
            <span className="leading-none">{symbolFor(currency)}</span>
          </div>
        )}
        <input
          {...rest}
          ref={ref}
          inputMode="decimal"
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder ?? (decimalSepFor(currency) === "," ? "0,00" : "0.00")}
          value={draft}
          onFocus={(e) => {
            setFocused(true);
            // select all for quick replace
            requestAnimationFrame(() => e.target.select?.());
            onFocus?.(e);
          }}
          onChange={(e) => {
            const raw = e.target.value;
            const dec = decimalSepFor(currency);
            // allow only digits, separators, optional leading minus
            const allowed = new RegExp(`[^0-9${dec === "," ? ",.\\-" : ",.\\-"}]`, "g");
            let cleaned = raw.replace(allowed, "");
            if (!allowNegative) cleaned = cleaned.replace(/-/g, "");
            // normalize: keep one decimal sep
            const parts = cleaned.split(dec);
            if (parts.length > 2) cleaned = parts[0] + dec + parts.slice(1).join("");
            const formatted = liveFormat(cleaned, currency);
            setDraft(formatted);
            emit(parseInput(formatted, currency));
          }}
          onBlur={(e) => {
            setFocused(false);
            const n = parseInput(draft, currency);
            setDraft(n == null ? "" : formatDisplay(n, currency));
            onBlur?.(e);
          }}
          className={cn(
            "flex-1 min-w-0 bg-transparent px-2.5 outline-none placeholder:text-muted-foreground/60 tabular-nums",
            align === "right" ? "text-right" : "text-left",
            size === "lg" && "font-semibold",
          )}
        />
        {showStepper && !disabled && (
          <div className="flex flex-col border-l border-input">
            <button
              type="button"
              tabIndex={-1}
              onClick={() => bump(1)}
              className="flex-1 px-1.5 hover:bg-secondary text-muted-foreground hover:text-foreground transition"
              aria-label="Aumentar"
            >
              <Plus className="h-3 w-3" />
            </button>
            <div className="border-t border-input" />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => bump(-1)}
              className="flex-1 px-1.5 hover:bg-secondary text-muted-foreground hover:text-foreground transition"
              aria-label="Diminuir"
            >
              <Minus className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    );
  },
);
MoneyInput.displayName = "MoneyInput";

function toEditable(value: number | string | null | undefined, currency?: Currency): string {
  if (value == null || value === "") return "";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "";
  return formatDisplay(n, currency);
}

export default MoneyInput;