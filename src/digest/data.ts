interface ComparisonPeriod {
  label?: string;
  period: string;
  y0: number;
  y1: number;
  y2: number;
  y3: number;
}

export interface DigestData {
  report_date: string;
  day_of_month: number;
  days_in_month: number;
  current_month: number;
  current_quarter: number;
  ytd: { actual: number; forecast: number; target: number; py_actual?: number };
  comparisons?: {
    years: number[];
    as_of: string;
    show_qtd: boolean;
    month_in_quarter: number;
    mtd: ComparisonPeriod;
    qtd: ComparisonPeriod;
    ytd: ComparisonPeriod;
  };
  quarters: Array<{ label: string; target: number; forecast: number; actual: number; orders: number; totes: number; py_actual?: number; is_closed: boolean; is_current: boolean }>;
  months: Array<{ label: string; target: number; forecast: number; actual: number; orders: number; totes: number; py_actual?: number; is_closed: boolean; is_current: boolean }>;
  top_customers: Array<{ name: string; revenue: number; orders: number; top_product: string | null }> | null;
  forecast_gaps: Array<{ name: string; forecast: number; actual: number; gap: number }> | null;
  top_products: Array<{ product: string; product_type: string; forecast: number; actual: number; gap: number }> | null;
  largest_orders: Array<{ order_number: number; customer: string; product: string; revenue: number; totes: number; order_date: string }> | null;
}

export async function fetchDigestData(supabaseUrl: string, supabaseKey: string): Promise<DigestData> {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/digest_full`, {
    method: 'POST',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!res.ok) throw new Error(`Supabase error ${res.status}: ${await res.text()}`);
  return res.json() as Promise<DigestData>;
}
