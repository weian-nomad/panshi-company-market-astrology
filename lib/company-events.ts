type UnknownRow = Record<string, string>;

type EventItem = {
  date: string;
  category: "除權息" | "股東會" | "重大訊息" | "暫停交易";
  title: string;
};

export type CompanyEventCheck = {
  status: "checked" | "partial" | "unavailable";
  windowDays: 7;
  items: EventItem[];
  checks: Array<{
    label: string;
    state: "found" | "checked" | "unavailable" | "not-integrated";
    detail: string;
  }>;
  checkedAt: string;
  freshnessNote: string;
};

const SOURCES = {
  dividends: "https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL",
  meetings: "https://openapi.twse.com.tw/v1/opendata/t187ap41_L",
  material: "https://openapi.twse.com.tw/v1/opendata/t187ap04_L",
  halts: "https://openapi.twse.com.tw/v1/exchangeReport/TWTAWU",
} as const;

function rocCompactDate(value: string) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!/^\d{7}$/.test(digits)) return null;
  const year = Number(digits.slice(0, 3)) + 1911;
  const result = `${year}-${digits.slice(3, 5)}-${digits.slice(5, 7)}`;
  const date = new Date(`${result}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== result
    ? null
    : result;
}

function nearTarget(date: string, targetDate: string, windowDays = 7) {
  const distance = Math.abs(
    new Date(`${date}T00:00:00Z`).getTime() - new Date(`${targetDate}T00:00:00Z`).getTime(),
  );
  return distance <= windowDays * 86_400_000;
}

function tidy(value: string, maximum = 88) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;
}

function dividendDetail(row: UnknownRow, kind: string) {
  const cash = Number(row.CashDividend);
  const stock = Number(row.StockDividendRatio);
  const details = [
    Number.isFinite(cash) && cash > 0 ? `每股現金股利 ${cash.toLocaleString("zh-TW")} 元` : null,
    Number.isFinite(stock) && stock > 0 ? `股票股利比率 ${stock.toLocaleString("zh-TW")}` : null,
  ].filter((item): item is string => Boolean(item));
  return details.length ? `${kind}，${details.join("，")}` : kind;
}

async function fetchRows(url: string, revalidate: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
      next: { revalidate },
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return Array.isArray(payload) ? payload as UnknownRow[] : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchCompanyEventCheck(
  symbol: string,
  targetDate: string,
): Promise<CompanyEventCheck> {
  const checkedAt = new Date().toISOString();
  const [dividends, meetings, material, halts] = await Promise.all([
    fetchRows(SOURCES.dividends, 21_600),
    fetchRows(SOURCES.meetings, 21_600),
    fetchRows(SOURCES.material, 1_800),
    fetchRows(SOURCES.halts, 1_800),
  ]);
  const availableCount = [dividends, meetings, material, halts].filter(Boolean).length;
  const items: EventItem[] = [];

  for (const row of dividends || []) {
    if (row.Code !== symbol) continue;
    const date = rocCompactDate(row.Date);
    if (!date || !nearTarget(date, targetDate)) continue;
    const kind = row.Exdividend === "息" ? "除息" : row.Exdividend === "權" ? "除權" : "除權息";
    items.push({
      date,
      category: "除權息",
      title: dividendDetail(row, kind),
    });
  }

  for (const row of meetings || []) {
    if (row["公司代號"] !== symbol) continue;
    const date = rocCompactDate(row["開會日期"]);
    if (!date || !nearTarget(date, targetDate)) continue;
    items.push({
      date,
      category: "股東會",
      title: `${row["股東常(臨時)會"] || "股東會"}${row["是否改選董監"] === "是" ? "，含董監改選" : ""}`,
    });
  }

  for (const row of material || []) {
    if (row["公司代號"] !== symbol) continue;
    const date = rocCompactDate(row["事實發生日"] || row["發言日期"]);
    if (!date || !nearTarget(date, targetDate)) continue;
    items.push({
      date,
      category: "重大訊息",
      title: tidy(row["主旨 "] || row["主旨"] || "當期重大訊息"),
    });
  }

  for (const row of halts || []) {
    if (row.Code !== symbol) continue;
    const dates = [rocCompactDate(row.TradingHaltDate), rocCompactDate(row.TradingResumptionDate)]
      .filter((date): date is string => Boolean(date));
    for (const date of dates) {
      if (!nearTarget(date, targetDate)) continue;
      items.push({
        date,
        category: "暫停交易",
        title: date === rocCompactDate(row.TradingHaltDate) ? "公告暫停交易" : "公告恢復交易",
      });
    }
  }

  items.sort((a, b) => a.date.localeCompare(b.date));
  const unavailableLabels = [
    dividends ? null : "除權息",
    meetings ? null : "股東會",
    material ? null : "當期重大訊息",
    halts ? null : "暫停交易",
  ].filter((label): label is string => Boolean(label));

  const checks: CompanyEventCheck["checks"] = [
    {
      label: "官方公司事件",
      state: unavailableLabels.length
        ? "unavailable"
        : items.length
          ? "found"
          : "checked",
      detail: unavailableLabels.length
        ? `${unavailableLabels.join("、")}本次未完成核對，其餘來源已查。`
        : items.length
          ? `在目標日前後 7 天找到 ${items.length} 筆已接入事件。`
          : "在目前接入的官方來源中，未見目標日前後 7 天的除權息、股東會、當期重大訊息或暫停交易。",
    },
    {
      label: "法說與財報排程",
      state: "not-integrated",
      detail: "法說與財報排程尚未完整覆蓋，仍需回原始公告核對。",
    },
  ];

  return {
    status: availableCount === 0 ? "unavailable" : availableCount === 4 ? "checked" : "partial",
    windowDays: 7,
    items,
    checks,
    checkedAt,
    freshnessNote: "含回應快取後，除權息與股東會資料最多可能延遲約 6 小時 45 分；當期重大訊息與暫停交易最多約 75 分鐘。",
  };
}
