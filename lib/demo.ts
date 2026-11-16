export const DEMO_EMAIL = "demo@facturafacil.co.mz";

export function demoLoginEnabled(): boolean {
  return process.env.DEMO_MODE !== "0";
}
