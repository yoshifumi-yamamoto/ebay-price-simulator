import { NextResponse } from "next/server";

type RateSummary = {
  carrier: string;
  service: string;
  price: number;
  currency: string;
  estimated_delivery_dates?: string | null;
  carrier_id?: string | null;
};

type RatesResult = {
  rates: RateSummary[];
  errors: string[];
};

type CacheEntry = {
  expiresAt: number;
  value: RatesResult;
};

const CACHE_TTL_MS = 60_000;
const rateCache = new Map<string, CacheEntry>();

const JAPAN_POST_SERVICES = [
  "japanpost_ems",
  "japanpost_epacket_light",
  "japanpost_smallpacket_air"
];

function buildCacheKey(
  destination: string,
  weight: number,
  width: number,
  height: number,
  depth: number,
  postal: string
) {
  return [
    destination,
    weight,
    width,
    height,
    depth,
    postal.trim().toUpperCase()
  ].join(":");
}

function pruneCache(now: number) {
  for (const [key, entry] of rateCache.entries()) {
    if (entry.expiresAt <= now) {
      rateCache.delete(key);
    }
  }
}

async function fetchRates(requestBody: Record<string, unknown>) {
  const apiKey = process.env.SHIPANDCO_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      status: 500,
      message: "SHIPANDCO_API_KEY が設定されていません。"
    };
  }

  const response = await fetch("https://api.shipandco.com/v1/rates", {
    method: "POST",
    headers: {
      "x-access-token": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody),
    cache: "no-store"
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    console.error("Ship&Co API error", {
      status: response.status,
      body: data
    });
    return {
      ok: false,
      status: response.status,
      message:
        data?.message ??
        data?.error ??
        "Ship&Co API の呼び出しに失敗しました。"
    };
  }

  console.log("Ship&Co API success payload", data);
  return { ok: true, data };
}

async function getRatesForDestination(params: {
  country: "US" | "GB";
  postal: string;
  weight: number;
  width: number;
  height: number;
  depth: number;
}) {
  const { country, postal, weight, width, height, depth } = params;
  const key = buildCacheKey(country, weight, width, height, depth, postal);
  const now = Date.now();
  pruneCache(now);
  const cached = rateCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const requestBody = {
    setup: {
      currency: "JPY"
    },
    from_address: {
      country: "JP",
      zip: "0600000",
      province: "Hokkaido",
      city: "Sapporo",
      address1: "Test",
      phone: "0000000000",
      full_name: "Sender"
    },
    to_address: {
      country,
      zip: postal,
      city: "Test City",
      address1: "Test Address",
      phone: "0000000000",
      full_name: "Receiver"
    },
    products: [
      {
        name: "Sample Item",
        quantity: 1,
        price: 3000,
        origin_country: "JP"
      }
    ],
    parcels: [
      {
        weight,
        amount: 1,
        width,
        height,
        depth
      }
    ],
    customs: {
      content_type: "MERCHANDISE"
    }
  };

  const apiResult = await fetchRates(requestBody);
  if (!apiResult.ok) {
    const errors = [
      `Ship&Co API 失敗 (${country}): ${apiResult.status} ${apiResult.message}`
    ];
    return { rates: [], errors };
  }

  const rawRates = Array.isArray(apiResult.data)
    ? apiResult.data
    : Array.isArray(apiResult.data?.rates)
    ? apiResult.data.rates
    : [];

  const filteredRates = rawRates.filter((rate: any) => {
    const carrier = String(rate?.carrier ?? "").toLowerCase();
    if (carrier.includes("dhl")) return true;
    if (carrier.includes("fedex")) return true;
    if (carrier.includes("japan post") || carrier.includes("japanpost")) {
      return JAPAN_POST_SERVICES.includes(String(rate?.service));
    }
    return false;
  });

  const rates: RateSummary[] = filteredRates.map((rate: any) => ({
    carrier: String(rate?.carrier ?? ""),
    service: String(rate?.service ?? ""),
    price: Number(rate?.price ?? 0),
    currency: String(rate?.currency ?? ""),
    estimated_delivery_dates: rate?.estimated_delivery_dates ?? null,
    carrier_id: rate?.carrier_id ?? null
  }));

  const errors: string[] = [];
  const apiErrors = rawRates
    .filter((rate: any) => Array.isArray(rate?.errors))
    .flatMap((rate: any) =>
      rate.errors.map((entry: any) =>
        entry?.message ? String(entry.message) : JSON.stringify(entry)
      )
    );
  errors.push(...apiErrors);
  const japanPostServices = rates
    .filter((rate) => rate.carrier.toLowerCase().includes("japan"))
    .map((rate) => rate.service);

  for (const service of JAPAN_POST_SERVICES) {
    if (!japanPostServices.includes(service)) {
      const label =
        service === "japanpost_ems"
          ? "EMS"
          : service === "japanpost_epacket_light"
          ? "eパケットライト"
          : "小型包装物（航空）";
      errors.push(`${label}：非対応/取得失敗`);
    }
  }

  const result: RatesResult = { rates, errors };
  rateCache.set(key, { expiresAt: now + CACHE_TTL_MS, value: result });
  return result;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json(
      { error: "リクエストが不正です。" },
      { status: 400 }
    );
  }

  const weight = Number(body.weight);
  const width = Number(body.width);
  const height = Number(body.height);
  const depth = Number(body.depth);

  if (
    !Number.isFinite(weight) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(depth)
  ) {
    return NextResponse.json(
      { error: "重量・サイズの入力が不正です。" },
      { status: 400 }
    );
  }

  const usZip = String(body.usZip ?? "10001").trim() || "10001";
  const ukPostcode = String(body.ukPostcode ?? "SW1A 1AA").trim() || "SW1A 1AA";

  const [usResult, ukResult] = await Promise.all([
    getRatesForDestination({
      country: "US",
      postal: usZip,
      weight,
      width,
      height,
      depth
    }),
    getRatesForDestination({
      country: "GB",
      postal: ukPostcode,
      weight,
      width,
      height,
      depth
    })
  ]);

  return NextResponse.json({
    US: usResult,
    UK: ukResult
  });
}
