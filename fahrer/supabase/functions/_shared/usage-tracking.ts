import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type AdminClient = ReturnType<typeof createClient>;

type UsageEventPayload = {
  job_id?: string | null;
  provider: string;
  action: string;
  reason: string;
  cache_hit?: boolean;
  requested_by?: string | null;
  http_status?: number | null;
  error_text?: string | null;
  units?: number;
  unit_name?: string;
};

type ProviderPrice = {
  unit_name: string;
  unit_price_eur: number;
};

const PROVIDER_PRICE_FALLBACK: Record<string, ProviderPrice> = {
  'google-places': { unit_name: 'request', unit_price_eur: 0.0028 },
  'google-routes': { unit_name: 'request', unit_price_eur: 0.0048 },
  // TomTom: 2.500 Abfragen am Tag frei, danach etwa 0,50 EUR je 1.000.
  tomtom: { unit_name: 'request', unit_price_eur: 0 },
  tomtom_geocode: { unit_name: 'request', unit_price_eur: 0 },
  opensky: { unit_name: 'request', unit_price_eur: 0 },
  aviationstack: { unit_name: 'request', unit_price_eur: 0 },
};

let cachedPricing: Map<string, ProviderPrice> | null = null;
let cachedPricingTs = 0;
const PRICING_CACHE_MS = 60_000;

const loadPricing = async (admin: AdminClient) => {
  const now = Date.now();
  if (cachedPricing && now - cachedPricingTs < PRICING_CACHE_MS) return cachedPricing;

  const { data } = await admin
    .from('api_provider_pricing')
    .select('provider,unit_name,unit_price_eur')
    .eq('is_active', true);

  const map = new Map<string, ProviderPrice>();
  for (const [provider, price] of Object.entries(PROVIDER_PRICE_FALLBACK)) {
    map.set(provider, price);
  }

  for (const row of data || []) {
    const provider = String(row.provider || '').trim().toLowerCase();
    const unitName = String(row.unit_name || '').trim() || 'request';
    const unitPriceEur = Number(row.unit_price_eur);
    if (!provider || !Number.isFinite(unitPriceEur) || unitPriceEur < 0) continue;
    map.set(provider, { unit_name: unitName, unit_price_eur: unitPriceEur });
  }

  cachedPricing = map;
  cachedPricingTs = now;
  return map;
};

export const recordUsageWithCost = async (admin: AdminClient, payload: UsageEventPayload) => {
  const provider = String(payload.provider || '').trim().toLowerCase();
  const units = Number.isFinite(payload.units) && Number(payload.units) > 0 ? Number(payload.units) : 1;
  const cacheHit = payload.cache_hit === true;

  let unitName = String(payload.unit_name || '').trim() || 'request';
  let unitPriceEur = 0;

  try {
    const pricing = await loadPricing(admin);
    const row = pricing.get(provider);
    if (row) {
      unitName = row.unit_name;
      unitPriceEur = row.unit_price_eur;
    }
  } catch {
    // never fail request flow on pricing lookup errors
  }

  const estimatedCostEur = cacheHit ? 0 : Number((units * unitPriceEur).toFixed(6));

  try {
    await admin.from('api_usage_events').insert([
      {
        job_id: payload.job_id || null,
        provider,
        action: payload.action,
        reason: payload.reason,
        cache_hit: cacheHit,
        requested_by: payload.requested_by || null,
        http_status: payload.http_status ?? null,
        error_text: payload.error_text ?? null,
        units,
        unit_name: unitName,
        unit_price_eur: unitPriceEur,
        estimated_cost_eur: estimatedCostEur,
      },
    ]);
  } catch {
    // logging must stay best effort
  }

  if (!cacheHit && payload.requested_by) {
    try {
      await admin.from('ai_token_usage').insert([
        {
          user_id: payload.requested_by,
          service: provider,
          tokens_used: units,
        },
      ]);
    } catch {
      // logging must stay best effort
    }
  }
};
