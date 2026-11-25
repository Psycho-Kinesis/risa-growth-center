/**
 * Arithmetic only: numbers, + - * / ** and parentheses. No names, no function calls,
 * so it cannot execute anything else. Used by the copilot for reliable maths.
 */
export function calculate(expression: string): number {
  if (typeof expression !== "string" || expression.length > 500) throw new Error("expression must be a short string");
  const expr = expression.replace(/,/g, "").replace(/×/g, "*").replace(/÷/g, "/").replace(/₹/g, "");
  if (!/^[0-9+\-*/().\s]+$/.test(expr)) {
    throw new Error("Only numbers, + - * / ** and parentheses are allowed (no names or percent signs; write 12% as 0.12).");
  }
  // eslint-disable-next-line no-new-func
  const v = Function(`"use strict"; return (${expr});`)();
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error("Result is not a finite number");
  return Math.round(v * 1e6) / 1e6;
}
