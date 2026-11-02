import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { importPKCS8, SignJWT } from 'https://esm.sh/jose@5.9.6';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';

const ensureEnv = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
};

const base64UrlDecode = (value: string) => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
};

const parseJwtPayload = (token: string): Record<string, unknown> | null => {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    return JSON.parse(base64UrlDecode(parts[1]));
  } catch {
    return null;
  }
};

const getBearerToken = (authHeader: string | null) => {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(' ');
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') return null;
  return token;
};

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

const asDate = (value: unknown, fallback: string) => {
  const s = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return fallback;
  return s;
};

const providerFromSku = (sku: string) => {
  const s = sku.toLowerCase();
  if (s.includes('autocomplete') || s.includes('places api')) return 'google-places';
  if (s.includes('direction') || s.includes('route') || s.includes('distance matrix')) return 'google-routes';
  return 'google-maps-other';
};

const getServiceAccountAccessToken = async () => {
  const clientEmail = ensureEnv('GCP_SERVICE_ACCOUNT_EMAIL');
  const privateKeyRaw = ensureEnv('GCP_SERVICE_ACCOUNT_PRIVATE_KEY');
  const privateKey = privateKeyRaw.replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);

  const pk = await importPKCS8(privateKey, 'RS256');
  const jwt = await new SignJWT({
    scope: 'https://www.googleapis.com/auth/bigquery.readonly https://www.googleapis.com/auth/monitoring.read',
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(clientEmail)
    .setSubject(clientEmail)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(pk);

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const tokenPayload = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenPayload?.access_token) {
    throw new Error(`Google OAuth failed: ${JSON.stringify(tokenPayload)}`);
  }
  return String(tokenPayload.access_token);
};

const parseBigQueryRows = (rows: Array<{ f: Array<{ v: unknown }> }> | undefined) => {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const f = Array.isArray(r?.f) ? r.f : [];
    return {
      usage_date: String(f[0]?.v ?? ''),
      service_description: String(f[1]?.v ?? ''),
      sku_id: String(f[2]?.v ?? ''),
      sku_description: String(f[3]?.v ?? ''),
      usage_amount: Number(f[4]?.v ?? 0),
      usage_unit: String(f[5]?.v ?? ''),
      cost_amount: Number(f[6]?.v ?? 0),
      currency: String(f[7]?.v ?? 'EUR'),
    };
  });
};

const syncBillingCosts = async (
  admin: ReturnType<typeof createClient>,
  accessToken: string,
  startDate: string,
  endDate: string,
) => {
  const projectId = ensureEnv('GCP_BILLING_PROJECT_ID');
  const dataset = ensureEnv('GCP_BILLING_DATASET');
  const table = ensureEnv('GCP_BILLING_TABLE');
  const location = Deno.env.get('GCP_BIGQUERY_LOCATION') || 'EU';
  const mapsServiceName = Deno.env.get('GCP_MAPS_SERVICE_NAME') || 'Google Maps Platform';
  const tableRef = `\`${projectId}.${dataset}.${table}\``;

  const query = `
select
  date(usage_start_time) as usage_date,
  service.description as service_description,
  sku.id as sku_id,
  sku.description as sku_description,
  sum(cast(usage.amount as numeric)) as usage_amount,
  any_value(usage.unit) as usage_unit,
  sum(cast(cost as numeric)) as cost_amount,
  any_value(currency) as currency
from ${tableRef}
where date(usage_start_time) between @startDate and @endDate
  and lower(service.description) = lower(@mapsServiceName)
group by 1,2,3,4
order by 1 desc, 3
`;

  const queryRes = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      useLegacySql: false,
      location,
      timeoutMs: 120000,
      parameterMode: 'NAMED',
      query,
      queryParameters: [
        { name: 'startDate', parameterType: { type: 'DATE' }, parameterValue: { value: startDate } },
        { name: 'endDate', parameterType: { type: 'DATE' }, parameterValue: { value: endDate } },
        { name: 'mapsServiceName', parameterType: { type: 'STRING' }, parameterValue: { value: mapsServiceName } },
      ],
    }),
  });

  const queryPayload = await queryRes.json().catch(() => ({}));
  if (!queryRes.ok) {
    throw new Error(`BigQuery query failed: ${JSON.stringify(queryPayload)}`);
  }

  const rows = parseBigQueryRows(queryPayload?.rows);
  const upsertRows = rows.map((row) => ({
    usage_date: row.usage_date,
    provider: providerFromSku(row.sku_description),
    service_description: row.service_description,
    sku_id: row.sku_id,
    sku_description: row.sku_description,
    usage_amount: Number.isFinite(row.usage_amount) ? row.usage_amount : 0,
    usage_unit: row.usage_unit || null,
    cost_eur: Number.isFinite(row.cost_amount) ? row.cost_amount : 0,
    currency: row.currency || 'EUR',
    source_table: `${projectId}.${dataset}.${table}`,
  }));

  if (upsertRows.length > 0) {
    const { error } = await admin
      .from('api_cost_actual_daily')
      .upsert(upsertRows, { onConflict: 'usage_date,provider,sku_id,source_table' });
    if (error) throw new Error(`Supabase upsert api_cost_actual_daily failed: ${error.message}`);
  }

  const { error: runError } = await admin.from('api_cost_import_runs').insert([
    {
      source: 'google_billing_bigquery',
      range_start: startDate,
      range_end: endDate,
      rows_written: upsertRows.length,
      status: 'ok',
    },
  ]);
  if (runError) throw new Error(`Failed to insert api_cost_import_runs: ${runError.message}`);

  return { rows_written: upsertRows.length };
};

const syncMonitoringUsage = async (
  admin: ReturnType<typeof createClient>,
  accessToken: string,
  startIso: string,
  endIso: string,
) => {
  const projectId = ensureEnv('GCP_MONITORING_PROJECT_ID');
  const filter = Deno.env.get('GCP_MONITORING_FILTER')
    || 'metric.type="serviceruntime.googleapis.com/api/request_count" AND resource.type="consumed_api"';

  const url = new URL(`https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries`);
  url.searchParams.set('filter', filter);
  url.searchParams.set('interval.startTime', startIso);
  url.searchParams.set('interval.endTime', endIso);
  url.searchParams.set('view', 'FULL');
  url.searchParams.set('pageSize', '1000');

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Monitoring API failed: ${JSON.stringify(payload)}`);
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const series of payload?.timeSeries || []) {
    const metricType = String(series?.metric?.type || '');
    const responseCode = String(series?.metric?.labels?.response_code || '');
    const service = String(series?.resource?.labels?.service || '').toLowerCase();
    const provider = service.includes('maps') ? 'google-maps-platform' : (service || 'google-api');

    for (const point of series?.points || []) {
      const observedAt = String(point?.interval?.endTime || '');
      const rawValue = point?.value?.int64Value ?? point?.value?.doubleValue ?? point?.value?.value ?? 0;
      const value = Number(rawValue);
      if (!observedAt || !Number.isFinite(value)) continue;
      rows.push({
        observed_at: observedAt,
        provider,
        metric_type: metricType,
        response_code: responseCode || null,
        value,
        project_id: projectId,
      });
    }
  }

  if (rows.length > 0) {
    const { error } = await admin
      .from('api_usage_monitoring_timeseries')
      .upsert(rows, { onConflict: 'observed_at,provider,metric_type,response_code' });
    if (error) throw new Error(`Supabase upsert api_usage_monitoring_timeseries failed: ${error.message}`);
  }

  const { error: runError } = await admin.from('api_cost_import_runs').insert([
    {
      source: 'google_monitoring',
      range_start: startIso.slice(0, 10),
      range_end: endIso.slice(0, 10),
      rows_written: rows.length,
      status: 'ok',
    },
  ]);
  if (runError) throw new Error(`Failed to insert monitoring import run: ${runError.message}`);

  return { rows_written: rows.length };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const supabaseUrl = ensureEnv('SUPABASE_URL');
  const supabaseServiceRoleKey = ensureEnv('SUPABASE_SERVICE_ROLE_KEY');
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse(401, { error: 'Missing authorization header' });

  const bearerToken = getBearerToken(authHeader);
  const tokenPayload = bearerToken ? parseJwtPayload(bearerToken) : null;
  const tokenRole = typeof tokenPayload?.role === 'string' ? tokenPayload.role : null;
  if (tokenRole !== 'service_role') {
    return jsonResponse(403, { error: 'Only service_role token can run this function' });
  }

  const admin = createClient(supabaseUrl, supabaseServiceRoleKey);
  const body = await req.json().catch(() => ({}));
  const mode = String(body?.mode || 'all').trim().toLowerCase(); // billing, monitoring, all

  const today = new Date();
  const defaultStart = new Date(today);
  defaultStart.setDate(today.getDate() - 7);

  const startDate = asDate(body?.start_date, isoDate(defaultStart));
  const endDate = asDate(body?.end_date, isoDate(today));
  const monitoringStartIso = String(body?.monitoring_start_iso || `${startDate}T00:00:00Z`);
  const monitoringEndIso = String(body?.monitoring_end_iso || `${endDate}T23:59:59Z`);

  try {
    const accessToken = await getServiceAccountAccessToken();
    const result: Record<string, unknown> = {
      mode,
      start_date: startDate,
      end_date: endDate,
    };

    if (mode === 'billing' || mode === 'all') {
      result.billing = await syncBillingCosts(admin, accessToken, startDate, endDate);
    }
    if (mode === 'monitoring' || mode === 'all') {
      result.monitoring = await syncMonitoringUsage(admin, accessToken, monitoringStartIso, monitoringEndIso);
    }

    return jsonResponse(200, { ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    try {
      await admin.from('api_cost_import_runs').insert([
        {
          source: mode === 'monitoring' ? 'google_monitoring' : 'google_billing_bigquery',
          range_start: startDate,
          range_end: endDate,
          rows_written: 0,
          status: 'error',
          error_text: message,
        },
      ]);
    } catch {
      // never mask original import error
    }
    return jsonResponse(500, { ok: false, error: message });
  }
});
