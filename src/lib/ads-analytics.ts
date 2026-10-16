import { getTargetWorkdayLabel, getWorkdayCycle } from "./order-workday.ts";
import type {
  AdsAdDay, AdsAdReport, AdsCampaignHour, AdsCampaignReport, AdsMetrics,
  AdsPeriod, AdsPeriodKind, AdsRecommendation, AdsReport, AdsSettings, AdsSnapshot, AdsSummary,
} from "./ads-types.ts";

const SARAJEVO = "Europe/Sarajevo";
const BAM_PER_EUR = 1.95583;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MAX_PERIOD_DAYS = 90;
const formatters = new Map<string, Intl.DateTimeFormat>();

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };
type Totals = AdsMetrics & { missingPurchaseValue: boolean };

function localParts(timestamp: number, timeZone: string): LocalParts {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
      minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  return Object.fromEntries(formatter.formatToParts(new Date(timestamp))
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, Number(part.value)])) as LocalParts;
}

function dateKey(parts: Pick<LocalParts, "year" | "month" | "day">): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function parseDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Datum mora biti u formatu YYYY-MM-DD.");
  const [year, month, day] = value.split("-").map(Number);
  const result = Date.UTC(year, month - 1, day);
  if (year < 1900 || year > 9999 || new Date(result).toISOString().slice(0, 10) !== value) {
    throw new Error(`Neispravan kalendarski datum: ${value}.`);
  }
  return result;
}

function shiftDate(value: string, days: number): string {
  return new Date(parseDate(value) + days * DAY_MS).toISOString().slice(0, 10);
}

function readableDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}.`;
}

function offsetAt(timestamp: number, timeZone: string): number {
  const parts = localParts(timestamp, timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    - Math.floor(timestamp / 1000) * 1000;
}

// Google aggregates a repeated DST hour into one date/hour row. Keep both possible
// UTC starts so that the row is counted once, only if the whole bucket belongs.
function hourInstants(date: string, hour: number, timeZone: string): number[] {
  const approximate = parseDate(date) + hour * HOUR_MS;
  const offsets = new Set([-36, -12, 0, 12, 36].map((hours) => offsetAt(approximate + hours * HOUR_MS, timeZone)));
  return [...offsets].map((offset) => approximate - offset).filter((instant) => {
    const actual = localParts(instant, timeZone);
    return dateKey(actual) === date && actual.hour === hour && actual.minute === 0 && actual.second === 0;
  }).sort((a, b) => a - b);
}

function atMidnight(date: string, timeZone: string): number {
  const candidates = hourInstants(date, 0, timeZone);
  if (!candidates.length) throw new Error(`Nije moguće odrediti početak dana ${date} u zoni ${timeZone}.`);
  return candidates[0];
}

function checkedNow(now: Date): number {
  const timestamp = now.getTime();
  if (!Number.isFinite(timestamp)) throw new Error("Neispravno trenutno vrijeme.");
  return timestamp;
}

export function defaultAdsSettings(): AdsSettings {
  return { targetRoas: null, minimumSpendBam: 30, minimumClicks: 30, minimumPurchases: 3, attributionLagDays: 3 };
}

export function buildAdsPeriod(
  input: { kind?: string; date?: string; from?: string; to?: string },
  now = new Date(),
): AdsPeriod {
  const timestamp = checkedNow(now);
  const today = dateKey(localParts(timestamp, SARAJEVO));
  const kind = input.kind ?? "workday";
  if (!["workday", "weekend", "7days", "30days", "custom"].includes(kind)) {
    throw new Error("Nepoznat raspon za reklame.");
  }
  if (input.date) parseDate(input.date);

  if (kind === "workday" || kind === "weekend") {
    let endDate: string;
    if (kind === "workday") {
      const [day, month, year] = getTargetWorkdayLabel(now).split("/");
      endDate = input.date ?? `${year}-${month}-${day}`;
      const dayOfWeek = new Date(parseDate(endDate)).getUTCDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) throw new Error("Datum radnog ciklusa mora biti radni dan; za vikend izaberi ponedjeljak.");
    } else if (input.date) {
      // A weekend is identified by its Monday end date, matching workday cycles.
      endDate = input.date;
      if (new Date(parseDate(endDate)).getUTCDay() !== 1) throw new Error("Datum vikend ciklusa mora biti ponedjeljak na kojem ciklus završava.");
    } else {
      const weekday = new Date(parseDate(today)).getUTCDay();
      let friday = shiftDate(today, -((weekday + 2) % 7));
      const fridayCutoff = getWorkdayCycle(shiftDate(friday, 3)).start.getTime();
      if (fridayCutoff > timestamp) friday = shiftDate(friday, -7);
      endDate = shiftDate(friday, 3);
    }
    const cycle = getWorkdayCycle(endDate);
    if (cycle.start.getTime() > timestamp) throw new Error("Nije moguće odabrati ciklus koji još nije počeo.");
    return {
      kind, date: endDate, start: cycle.start.toISOString(), end: cycle.end.toISOString(),
      label: `${cycle.startLabel} 08:00 – ${cycle.endLabel} 08:00 · Sarajevo`,
      complete: cycle.end.getTime() <= timestamp,
    };
  }

  let from: string;
  let to: string;
  if (kind === "custom") {
    if (!input.from || !input.to) throw new Error("Odaberi početni i završni datum.");
    from = input.from;
    to = input.to;
  } else {
    to = input.date ?? today;
    from = shiftDate(to, kind === "7days" ? -6 : -29);
  }
  const startDay = parseDate(from);
  const endDay = parseDate(to);
  const days = (endDay - startDay) / DAY_MS + 1;
  if (days < 1 || days > MAX_PERIOD_DAYS) throw new Error(`Raspon mora trajati između 1 i ${MAX_PERIOD_DAYS} dana.`);
  if (to > today || from > today) throw new Error("Nije moguće odabrati budući kalendarski datum.");
  const start = atMidnight(from, SARAJEVO);
  const end = atMidnight(shiftDate(to, 1), SARAJEVO);
  return {
    kind: kind as AdsPeriodKind, date: to,
    start: new Date(start).toISOString(), end: new Date(end).toISOString(),
    label: `${readableDate(from)} – ${readableDate(to)} · kalendarski dani, Sarajevo`,
    complete: end <= timestamp,
  };
}

function emptyTotals(): Totals {
  return { impressions: 0, clicks: 0, cost: 0, purchases: 0, purchaseValue: 0, missingPurchaseValue: false };
}

function addMetrics(total: Totals, row: AdsMetrics): void {
  total.impressions += row.impressions;
  total.clicks += row.clicks;
  total.cost += row.cost;
  total.purchases += row.purchases;
  if (Number.isFinite(row.purchaseValue)) total.purchaseValue += row.purchaseValue;
  if (!Number.isFinite(row.purchaseValue) || (row.purchases > 0 && row.purchaseValue <= 0)) total.missingPurchaseValue = true;
}

function summarize(total: Totals, currency: string, tracking: boolean): AdsSummary {
  const bamRate = currency === "EUR" ? BAM_PER_EUR : currency === "BAM" ? 1 : null;
  const spendBam = bamRate === null ? null : total.cost * bamRate;
  const valueKnown = tracking && !total.missingPurchaseValue;
  const revenueBam = !valueKnown || bamRate === null ? null : total.purchaseValue * bamRate;
  return {
    impressions: total.impressions, clicks: total.clicks,
    spendBam, spendEur: spendBam === null ? null : spendBam / BAM_PER_EUR,
    purchases: tracking ? total.purchases : null, revenueBam,
    roas: valueKnown && total.cost > 0 ? total.purchaseValue / total.cost : null,
    ctr: total.impressions > 0 ? total.clicks / total.impressions : null,
    cpcBam: spendBam !== null && total.clicks > 0 ? spendBam / total.clicks : null,
    cpaBam: tracking && spendBam !== null && total.purchases > 0 ? spendBam / total.purchases : null,
  };
}

function checkedSettings(settings: AdsSettings): AdsSettings {
  if (settings.targetRoas !== null && (!Number.isFinite(settings.targetRoas) || settings.targetRoas <= 0)) {
    throw new Error("Ciljni ROAS mora biti pozitivan broj ili ostati nepostavljen.");
  }
  for (const value of [settings.minimumSpendBam, settings.minimumClicks, settings.minimumPurchases]) {
    if (!Number.isFinite(value) || value < 0) throw new Error("Pragovi reklama moraju biti konačni nenegativni brojevi.");
  }
  if (!Number.isInteger(settings.attributionLagDays) || settings.attributionLagDays < 0 || settings.attributionLagDays > 30) {
    throw new Error("Kašnjenje konverzija mora biti između 0 i 30 cijelih dana.");
  }
  return settings;
}

function recommend(
  summary: AdsSummary, status: string, settings: AdsSettings, covered: boolean, fresh: boolean,
): AdsRecommendation {
  if (["PAUSED", "REMOVED", "DISABLED"].includes(status.toUpperCase())) {
    return { decision: "inactive", label: "Neaktivan", reason: "Oglas je pauziran ili uklonjen. Prikazani rezultati su historijski." };
  }
  if (!fresh) {
    return { decision: "wait", label: "Osvježi podatke", reason: "Podaci su stariji od šest sati ili vrijeme sinhronizacije nije poznato. Osvježi ih prije odluke o zadržavanju ili pauziranju oglasa." };
  }
  if (summary.purchases === null) {
    return { decision: "tracking", label: "Provjeri praćenje", reason: "Google Ads nema potvrđenu konverziju kategorije kupovina. Bez nje nije moguće procijeniti prodaju i ROAS." };
  }
  if (summary.roas === null && summary.purchases > 0) {
    return { decision: "tracking", label: "Provjeri vrijednost", reason: "Kupovine postoje, ali vrijednost kupovine ili potrošnja potrebna za ROAS nedostaje. Provjeri vrijednosti konverzija." };
  }
  if (!covered) {
    return { decision: "wait", label: "Sačekaj podatke", reason: "Sinhronizacija ne pokriva cijeli 14-dnevni period procjene. Preporuka čeka potpunu historiju." };
  }
  if (summary.spendBam === null) {
    return { decision: "wait", label: "Provjeri valutu", reason: "Valuta računa nije EUR ili BAM. Prag potrošnje u KM se ne može pouzdano provjeriti." };
  }
  if (settings.targetRoas === null) {
    return { decision: "wait", label: "Postavi cilj", reason: "Postavi ciljni ROAS prema marži i troškovima poslovanja da bi preporuke imale smislen prag." };
  }
  if (summary.roas === null || (summary.clicks === 0 && summary.purchases === 0)) {
    return { decision: "wait", label: "Sačekaj podatke", reason: "Još nema dovoljno potrošnje i rezultata za izračun ROAS-a." };
  }
  if (summary.purchases >= settings.minimumPurchases && summary.purchases > 0 && summary.roas >= settings.targetRoas) {
    return { decision: "keep", label: "Zadrži", reason: `ROAS ${summary.roas.toFixed(2)}× dostiže cilj ${settings.targetRoas.toFixed(2)}× uz ${summary.purchases.toLocaleString("bs-BA")} kupovina (prag ${settings.minimumPurchases}).` };
  }
  if (summary.spendBam >= settings.minimumSpendBam && summary.clicks >= settings.minimumClicks && summary.roas < settings.targetRoas) {
    return { decision: "review", label: "Razmotri pauziranje", reason: `Potrošeno je ${summary.spendBam.toFixed(2)} KM uz ${summary.clicks} klikova, a ROAS ${summary.roas.toFixed(2)}× je ispod cilja ${settings.targetRoas.toFixed(2)}×. Provjeri oglas i odredišnu stranicu prije odluke.` };
  }
  return {
    decision: "wait", label: "Sačekaj podatke",
    reason: `Uzorak još nije dovoljan: za zadržavanje treba najmanje ${settings.minimumPurchases} kupovina i ciljni ROAS; za procjenu pauziranja najmanje ${settings.minimumSpendBam} KM i ${settings.minimumClicks} klikova.`,
  };
}

export function buildAdsReport(snapshot: AdsSnapshot, period: AdsPeriod, settings: AdsSettings, now = new Date()): AdsReport {
  const timestamp = checkedNow(now);
  checkedSettings(settings);
  const start = Date.parse(period.start);
  const end = Date.parse(period.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start > timestamp) throw new Error("Neispravan period izvještaja.");
  const effectiveEnd = Math.min(end, timestamp);
  const timeZone = snapshot.account.timeZone;
  const currency = snapshot.account.currency.toUpperCase();
  const tracking = snapshot.purchaseTracking.configured;
  const warnings = new Set<string>();
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  const snapshotFresh = Number.isFinite(fetchedAt) && timestamp - fetchedAt <= 6 * HOUR_MS;
  if (!snapshotFresh) warnings.add("Podaci su stariji od šest sati ili vrijeme sinhronizacije nije poznato. Prikazan je posljednji poznati učinak, a preporuke čekaju osvježavanje.");
  if (snapshot.campaigns.some((campaign) => campaign.channel === "PERFORMANCE_MAX")) {
    warnings.add("Kod Performance Max kampanja lista pojedinačnih oglasa ne obuhvata sve oglase i grupe elemenata. Ukupni učinak tih kampanja prati se u pregledu kampanja.");
  }
  if (currency !== "EUR" && currency !== "BAM") warnings.add(`Valuta računa je ${currency}. Preračun u EUR/KM nije dostupan; ROAS se računa iz prihoda i potrošnje u izvornoj valuti.`);
  if (!tracking) warnings.add("Nije potvrđeno praćenje kupovina u Google Ads. Prodaja i ROAS ostaju nepoznati; ukupne narudžbe trgovine se ne pripisuju reklamama.");
  warnings.add("Prikazani povrat je ROAS (prihod od pripisanih kupovina / potrošnja oglasa), a ne dobit. Marža, dostava, povrati i ostali troškovi nisu odbijeni.");

  const accountFirstDate = dateKey(localParts(start, timeZone));
  const accountLastDate = dateKey(localParts(Math.max(start, effectiveEnd - 1), timeZone));
  if (snapshot.fromDate > accountFirstDate || snapshot.toDate < accountLastDate) {
    warnings.add("Dio odabranog raspona nije obuhvaćen preuzetim podacima. Prikazani zbir obuhvata samo dostupnu historiju.");
  }
  const boundaryParts = [localParts(start, timeZone), localParts(end, timeZone)];
  if (boundaryParts.some((part) => part.minute !== 0 || part.second !== 0)) {
    warnings.add("Granice Sarajevo perioda ne poklapaju se sa satnim segmentima vremenske zone Google Ads računa. Uključeni su samo cijeli segmenti; zbir nije precizan za cijeli odabrani raspon.");
  }

  const total = emptyTotals();
  const campaigns = new Map<string, { row: AdsCampaignHour; totals: Totals }>();
  const daily = new Map<string, Totals>();
  const lastTimelineDate = dateKey(localParts(Math.max(start, effectiveEnd - 1), SARAJEVO));
  for (let date = dateKey(localParts(start, SARAJEVO)); date <= lastTimelineDate; date = shiftDate(date, 1)) daily.set(date, emptyTotals());
  const hourCache = new Map<string, number[]>();
  for (const row of snapshot.campaigns) {
    if (!Number.isInteger(row.hour) || row.hour < 0 || row.hour > 23) { warnings.add("Neispravni satni segmenti su izostavljeni iz izvještaja."); continue; }
    const cacheKey = `${row.date}/${row.hour}`;
    let instants = hourCache.get(cacheKey);
    if (!instants) {
      try { instants = hourInstants(row.date, row.hour, timeZone); }
      catch { warnings.add("Neispravni datumi u satnim segmentima su izostavljeni iz izvještaja."); continue; }
      hourCache.set(cacheKey, instants);
    }
    if (instants.length === 0) {
      warnings.add("Neki satni segmenti ne mogu se precizno smjestiti zbog pomjeranja sata u vremenskoj zoni računa i izostavljeni su.");
      continue;
    }
    if (instants[0] >= effectiveEnd || instants.every((instant) => instant + HOUR_MS <= start || instant >= end)) continue;
    // Do not apportion an aggregated Google hour when only part of it is selected.
    if (instants.some((instant) => instant < start || instant + HOUR_MS > end)) {
      warnings.add("Satni segmenti koji samo djelimično ulaze u raspon nisu uključeni. Zbir može biti nepotpun zbog razlike vremenskih zona ili promjene sata.");
      continue;
    }
    const dates = new Set(instants.map((instant) => dateKey(localParts(instant, SARAJEVO))));
    if (dates.size !== 1) {
      warnings.add("Ponovljeni sat pri promjeni vremena prelazi granicu Sarajevo datuma. Taj segment je izostavljen jer dnevna raspodjela nije poznata.");
      continue;
    }
    addMetrics(total, row);
    const campaign = campaigns.get(row.campaignId) ?? { row, totals: emptyTotals() };
    campaign.row = row;
    addMetrics(campaign.totals, row);
    campaigns.set(row.campaignId, campaign);
    const date = [...dates][0];
    const dailyTotal = daily.get(date) ?? emptyTotals();
    addMetrics(dailyTotal, row);
    daily.set(date, dailyTotal);
  }
  if (tracking && total.missingPurchaseValue) warnings.add("Najmanje jedna kupovina nema upotrebljivu vrijednost. Prihod i ROAS za zahvaćeni zbir nisu prikazani dok se vrijednosti ne poprave.");

  const accountToday = dateKey(localParts(timestamp, timeZone));
  const recommendationEndExclusive = shiftDate(accountToday, -settings.attributionLagDays);
  const recommendationFrom = shiftDate(recommendationEndExclusive, -14);
  const recommendationTo = shiftDate(recommendationEndExclusive, -1);
  const recommendationsCovered = snapshot.fromDate <= recommendationFrom && snapshot.toDate >= recommendationTo;
  if (!recommendationsCovered) warnings.add("Historija ne pokriva svih 14 dana procjene oglasa. Pouzdane preporuke čekaju potpunu sinhronizaciju.");
  const adTotals = new Map<string, { row: AdsAdDay; totals: Totals }>();
  for (const row of snapshot.ads) {
    // Preserve newer status, but never add recent, immature attribution to decisions.
    const id = `${row.campaignId}/${row.adGroupId}/${row.adId}`;
    let entry = adTotals.get(id);
    if (!entry) { entry = { row, totals: emptyTotals() }; adTotals.set(id, entry); }
    if (row.date >= entry.row.date) entry.row = row;
    if (row.date >= recommendationFrom && row.date <= recommendationTo) addMetrics(entry.totals, row);
  }
  if (tracking && [...adTotals.values()].some((ad) => ad.totals.missingPurchaseValue)) {
    warnings.add("Dio oglasa u periodu procjene ima kupovine bez upotrebljivih vrijednosti; za njih se traži provjera praćenja.");
  }
  const campaignReports: AdsCampaignReport[] = [...campaigns.values()].sort((a, b) => b.totals.cost - a.totals.cost).map(({ row, totals }) => ({
    ...summarize(totals, currency, tracking), id: row.campaignId, name: row.campaignName, status: row.status, channel: row.channel,
  }));
  const adReports: AdsAdReport[] = [...adTotals.entries()].sort(([, a], [, b]) => b.totals.cost - a.totals.cost).map(([id, { row, totals }]) => {
    const summary = summarize(totals, currency, tracking);
    return {
      ...summary, id, name: row.adName || `Oglas ${row.adId}`, campaignName: row.campaignName,
      adGroupName: row.adGroupName, status: row.status, adType: row.adType,
      recommendation: recommend(summary, row.status, settings, recommendationsCovered, snapshotFresh),
    };
  });
  return {
    period, summary: summarize(total, currency, tracking), campaigns: campaignReports,
    timeline: [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, totals]) => ({ date, ...summarize(totals, currency, tracking) })),
    ads: adReports,
    recommendationPeriod: {
      from: recommendationFrom, to: recommendationTo,
      label: `${readableDate(recommendationFrom)} – ${readableDate(recommendationTo)} · 14 kalendarskih dana, ${timeZone}; ${settings.attributionLagDays} prethodna dana + danas izostavljeni zbog kašnjenja konverzija`,
    },
    warnings: [...warnings],
  };
}
