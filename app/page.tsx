"use client";

import { useEffect, useMemo, useState } from "react";

type Values = {
  costPrice: number;
  shippingFee: number;
  feePercent: number;
  targetProfitRate: number;
  exchangeRate: number;
  discountRate: number;
  weight: number;
  width: number;
  height: number;
  depth: number;
  usZip: string;
  ukPostcode: string;
};

const DHL_SERVICE_ENUM = {
  dhl_express_0900: {
    label: "DHL Express 09:00（午前9時まで配達）",
    description:
      "最速。対応エリア限定で、翌営業日9:00までの時間指定配達"
  },
  dhl_express_1200: {
    label: "DHL Express 12:00（正午まで配達）",
    description:
      "速達。対応エリア限定で、翌営業日12:00までの時間指定配達"
  },
  dhl_express_worldwide: {
    label: "DHL Express Worldwide（通常速達）",
    description: "DHLの標準国際速達。営業日中（EOD）までに配達"
  }
} as const;

const FEDEX_SERVICE_ENUM = {
  fedex_international_priority_express: {
    label: "FedEx International Priority Express",
    description: "最速クラス。地域により午前中（10:30/12:00）までの配達"
  },
  fedex_international_priority_eod: {
    label: "FedEx International Priority（EOD）",
    description: "速達。営業日中（End of Day）までに配達"
  },
  fedex_international_economy: {
    label: "FedEx International Economy",
    description: "優先便より遅いが料金を抑えた国際配送"
  },
  fedex_international_connect_plus: {
    label: "FedEx International Connect Plus（EC向け）",
    description: "eコマース向け。配達日確定型で比較的安価"
  }
} as const;

const JAPANPOST_SERVICE_ENUM = {
  japanpost_ems: {
    label: "EMS（国際スピード郵便）",
    description: "日本郵便の最速国際便。追跡・補償あり"
  },
  japanpost_epacket_light: {
    label: "国際eパケットライト",
    description: "小型・軽量向け。安価だが国・地域により取扱停止あり"
  },
  japanpost_smallpacket_air: {
    label: "小型包装物（航空便）",
    description: "安価な航空便。国・地域・時期により利用不可の場合あり"
  }
} as const;

type RateItem = {
  carrier: string;
  service: string;
  price: number;
  currency: string;
  estimated_delivery_dates?: string | null;
  carrier_id?: string | null;
};

const DHL_SERVICES = Object.keys(DHL_SERVICE_ENUM);
const FEDEX_SERVICES = Object.keys(FEDEX_SERVICE_ENUM);
const JAPANPOST_SERVICES = Object.keys(JAPANPOST_SERVICE_ENUM);

const defaultValues: Values = {
  costPrice: 0,
  shippingFee: 3000,
  feePercent: 21,
  targetProfitRate: 30,
  exchangeRate: 0,
  discountRate: 22,
  weight: 500,
  width: 20,
  height: 10,
  depth: 10,
  usZip: "10001",
  ukPostcode: "SW1A 1AA"
};

async function fetchExchangeRate(): Promise<number> {
  try {
    const apiURL =
      "https://api.exchangerate.host/latest?base=USD&symbols=JPY";
    const res = await fetch(
      "https://corsproxy.io/?" + encodeURIComponent(apiURL)
    );
    const data = await res.json();
    return Number(data?.rates?.JPY ?? 145);
  } catch {
    return 145;
  }
}

export default function Home() {
  const [values, setValues] = useState<Values>(defaultValues);
  const [rateLoaded, setRateLoaded] = useState(false);
  const [shipping, setShipping] = useState<{
    US?: { rates: RateItem[]; errors: string[] };
    UK?: { rates: RateItem[]; errors: string[] };
  }>({});
  const [shippingError, setShippingError] = useState<string | null>(null);
  const [shippingLoading, setShippingLoading] = useState(false);
  const [showServiceInfo, setShowServiceInfo] = useState(false);
  const [showPostalInputs, setShowPostalInputs] = useState(false);
  const [showShipErrors, setShowShipErrors] = useState(false);

  useEffect(() => {
    let active = true;
    fetchExchangeRate().then((rate) => {
      if (!active) return;
      setValues((prev) => ({ ...prev, exchangeRate: Number(rate.toFixed(2)) }));
      setRateLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const { profit, sellPriceJPY, discountedPriceUSD, originalPriceUSD, error } =
    useMemo(() => {
      const feeRate = values.feePercent / 100;
      const profitRate = values.targetProfitRate / 100;
      const discountRate = values.discountRate / 100;

      const totalCost = values.costPrice + values.shippingFee;
      const divisor = 1 - feeRate - profitRate;

      if (divisor <= 0) {
        return {
          profit: null,
          sellPriceJPY: null,
          discountedPriceUSD: null,
          originalPriceUSD: null,
          error: "利益率と手数料率の合計が100%を超えています。"
        };
      }

      const sellPriceJPY = totalCost / divisor;
      const profit = sellPriceJPY * profitRate;
      const sellPriceUSD = values.exchangeRate
        ? sellPriceJPY / values.exchangeRate
        : 0;
      const originalPriceUSD = discountRate < 1 ? sellPriceUSD / (1 - discountRate) : 0;

      return {
        profit,
        sellPriceJPY,
        discountedPriceUSD: sellPriceUSD,
        originalPriceUSD,
        error: null
      };
    }, [values]);

  const onNumberChange =
    (key: keyof Values) => (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextValue = Number(event.target.value);
      setValues((prev) => ({
        ...prev,
        [key]: Number.isFinite(nextValue) ? nextValue : 0
      }));
    };

  const onTextChange =
    (key: keyof Values) => (event: React.ChangeEvent<HTMLInputElement>) => {
      setValues((prev) => ({ ...prev, [key]: event.target.value }));
    };

  const fetchShippingRates = async () => {
    setShippingLoading(true);
    setShippingError(null);
    try {
      const response = await fetch("/api/rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weight: values.weight,
          width: values.width,
          height: values.height,
          depth: values.depth,
          usZip: values.usZip,
          ukPostcode: values.ukPostcode
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? "送料取得に失敗しました。");
      }

      setShipping(data);
    } catch (error) {
      setShippingError(
        error instanceof Error ? error.message : "送料取得に失敗しました。"
      );
    } finally {
      setShippingLoading(false);
    }
  };

  useEffect(() => {
    fetchShippingRates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="card">
      <h1>eBay価格シミュレータ</h1>
      <p className="note">注意: 現在US向けはDHLのみ対応しています。</p>

      <div className="grid">
        <section className="panel compact">
          <h2>原価・価格入力</h2>
          <label>
            仕入れ値（円）
            <input
              type="number"
              value={values.costPrice}
              onChange={onNumberChange("costPrice")}
            />
          </label>
          <label>
            送料（円）
            <input
              type="number"
              value={values.shippingFee}
              onChange={onNumberChange("shippingFee")}
            />
          </label>
          <label>
            手数料（％）
            <input
              type="number"
              value={values.feePercent}
              onChange={onNumberChange("feePercent")}
            />
          </label>
          <label>
            希望利益率（％）
            <input
              type="number"
              value={values.targetProfitRate}
              onChange={onNumberChange("targetProfitRate")}
            />
          </label>
          <label>
            為替レート（USD→JPY）
            <input
              type="number"
              value={values.exchangeRate}
              onChange={onNumberChange("exchangeRate")}
            />
          </label>
          <label>
            割引率（％）
            <input
              type="number"
              value={values.discountRate}
              onChange={onNumberChange("discountRate")}
            />
          </label>

          <div className="summary-card">
            {error ? (
              <div className="result">{error}</div>
            ) : (
              <>
                <div className="result">利益: ¥{profit ? Math.round(profit) : "-"}</div>
                <div className="result">
                  販売価格: ¥{sellPriceJPY ? Math.round(sellPriceJPY) : "-"}
                </div>
                <div className="result">
                  販売価格: ${discountedPriceUSD ? discountedPriceUSD.toFixed(2) : "-"}
                </div>
                <div className="result">
                  割引前価格: ${originalPriceUSD ? originalPriceUSD.toFixed(2) : "-"}
                </div>
                <div className="result">
                  想定US関税（15%）:{" "}$
                  {discountedPriceUSD ? (discountedPriceUSD * 0.15).toFixed(2) : "-"}
                </div>
              </>
            )}
          </div>
        </section>

        <section className="panel">
          <h2>送料シミュレーション</h2>
          <label>
            重量（g）
            <input type="number" value={values.weight} onChange={onNumberChange("weight")} />
          </label>
          <div className="row">
            <label>
              幅（cm）
              <input type="number" value={values.width} onChange={onNumberChange("width")} />
            </label>
            <label>
              高さ（cm）
              <input type="number" value={values.height} onChange={onNumberChange("height")} />
            </label>
            <label>
              奥行き（cm）
              <input type="number" value={values.depth} onChange={onNumberChange("depth")} />
            </label>
          </div>
          <div className="toggle-row">
            <button
              className="ghost"
              type="button"
              onClick={() => setShowPostalInputs((prev) => !prev)}
            >
              {showPostalInputs ? "宛先ZIP/POSTCODEを隠す" : "宛先ZIP/POSTCODEを表示"}
            </button>
          </div>
          {showPostalInputs ? (
            <>
              <label>
                US宛先ZIP（任意）
                <input type="text" value={values.usZip} onChange={onTextChange("usZip")} />
              </label>
              <label>
                UK宛先Postcode（任意）
                <input
                  type="text"
                  value={values.ukPostcode}
                  onChange={onTextChange("ukPostcode")}
                />
              </label>
            </>
          ) : null}

          <button className="primary" onClick={fetchShippingRates} disabled={shippingLoading}>
            {shippingLoading ? "取得中..." : "送料を取得"}
          </button>
          <button
            className="ghost"
            type="button"
            onClick={() => setShowServiceInfo(true)}
          >
            サービス一覧を見る
          </button>

          {shippingError ? <div className="result">{shippingError}</div> : null}
          <div className="toggle-row">
            <button
              className="ghost"
              type="button"
              onClick={() => setShowShipErrors((prev) => !prev)}
            >
              {showShipErrors ? "Ship&Coエラーを隠す" : "Ship&Coエラーを表示"}
            </button>
          </div>
          <div className="rates">
            <div className="rate-card">
              <h3>US</h3>
              <RatesList data={shipping.US} showErrors={showShipErrors} />
            </div>
            <div className="rate-card">
              <h3>UK</h3>
              <RatesList data={shipping.UK} showErrors={showShipErrors} />
            </div>
          </div>
        </section>
      </div>

      <p className="note">
        {!rateLoaded
          ? "為替レートを取得中です。"
          : "為替レートは取得後も手動で修正できます。"}
      </p>

      {showServiceInfo ? (
        <div className="modal">
          <div className="modal-card">
            <h3>サービス一覧</h3>
            <div className="service-table">
              <div className="service-row service-head">
                <span>キャリア</span>
                <span>サービス</span>
                <span>説明</span>
              </div>
              <ServiceRows carrier="DHL" data={DHL_SERVICE_ENUM} />
              <ServiceRows carrier="FedEx" data={FEDEX_SERVICE_ENUM} />
              <ServiceRows carrier="Japan Post" data={JAPANPOST_SERVICE_ENUM} />
            </div>
            <button className="primary" type="button" onClick={() => setShowServiceInfo(false)}>
              閉じる
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function RatesList({
  data,
  showErrors
}: {
  data?: { rates: RateItem[]; errors: string[] };
  showErrors: boolean;
}) {
  if (!data) {
    return <div className="rate-item">取得データがありません。</div>;
  }

  const dhlRates = data.rates.filter(
    (rate) => rate.carrier.toLowerCase() === "dhl" && DHL_SERVICES.includes(rate.service)
  );
  const fedexRates = data.rates.filter(
    (rate) =>
      rate.carrier.toLowerCase() === "fedex" && FEDEX_SERVICES.includes(rate.service)
  );
  const japanPostRates = data.rates.filter(
    (rate) =>
      rate.carrier.toLowerCase().includes("japan") &&
      JAPANPOST_SERVICES.includes(rate.service)
  );

  const cheapestDhl = dhlRates.sort((a, b) => a.price - b.price)[0];
  const cheapestFedex = fedexRates.sort((a, b) => a.price - b.price)[0];

  const displayRates = [
    ...(cheapestDhl ? [cheapestDhl] : []),
    ...(cheapestFedex ? [cheapestFedex] : []),
    ...japanPostRates
  ];

  return (
    <>
      {displayRates.length ? (
        displayRates.map((rate) => (
          <div className="rate-item" key={`${rate.carrier}-${rate.service}`}>
            <span>{formatCarrier(rate.carrier)}</span>
            <span>{formatServiceLabel(rate)}</span>
            <span>
              {rate.price} {rate.currency}
            </span>
          </div>
        ))
      ) : (
        <div className="rate-item">取得データがありません。</div>
      )}
      {showErrors
        ? data.errors?.map((message) => (
          <div className="rate-error" key={message}>
            {message}
          </div>
        ))
        : null}
    </>
  );
}

function formatCarrier(carrier: string) {
  const normalized = carrier.toLowerCase();
  if (normalized === "fedex") return "FedEx";
  if (normalized === "dhl") return "DHL";
  if (normalized.includes("japan")) return "Japan Post";
  return carrier;
}

function formatServiceLabel(rate: RateItem) {
  if (rate.carrier.toLowerCase() === "dhl") {
    return DHL_SERVICE_ENUM[rate.service as keyof typeof DHL_SERVICE_ENUM]?.label ?? rate.service;
  }
  if (rate.carrier.toLowerCase() === "fedex") {
    return (
      FEDEX_SERVICE_ENUM[rate.service as keyof typeof FEDEX_SERVICE_ENUM]?.label ??
      rate.service
    );
  }
  if (rate.carrier.toLowerCase().includes("japan")) {
    return (
      JAPANPOST_SERVICE_ENUM[
        rate.service as keyof typeof JAPANPOST_SERVICE_ENUM
      ]?.label ?? rate.service
    );
  }
  return rate.service;
}

function ServiceRows({
  carrier,
  data
}: {
  carrier: string;
  data: Record<string, { label: string; description: string }>;
}) {
  return (
    <>
      {Object.values(data).map((entry) => (
        <div className="service-row" key={`${carrier}-${entry.label}`}>
          <span>{carrier}</span>
          <span>{entry.label}</span>
          <span>{entry.description}</span>
        </div>
      ))}
    </>
  );
}
