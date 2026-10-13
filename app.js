const REQUIRED_ITEM_FIELDS = [
  "itemName",
  "itemID",
  "availableQuantity",
  "vendorSellPrice",
  "averagePrice",
  "medianPrice",
  "lowestBuyout",
  "highestBuyout",
];
const CHART_METRICS = {
  lowestBuyout: { label: "Lowest Buyout", format: "money" },
  availableQuantity: { label: "Quantity", format: "quantity" },
  averagePrice: { label: "Average Price", format: "money" },
  medianPrice: { label: "Median Price", format: "money" },
  highestBuyout: { label: "Highest Buyout", format: "money" },
};
const numberFormat = new Intl.NumberFormat("de-DE");
const dateFormat = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});
const WATCHLIST_STORAGE_KEY = "ahscans-watchlist-v1";
const MAX_CANDIDATES = 100;
const REFERENCE_WINDOW = 5;
const MAX_DATA_AGE_HOURS = 72;
const swingPercentFormat = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

const elements = {
  scanCount: document.querySelector("#scan-count"),
  datasetNote: document.querySelector("#dataset-note"),
  workspace: document.querySelector("#workspace"),
  chartPanel: document.querySelector("#chart-panel"),
  loading: document.querySelector("#loading"),
  error: document.querySelector("#error"),
  search: document.querySelector("#item-search"),
  suggestions: document.querySelector("#suggestions"),
  searchHint: document.querySelector("#search-hint"),
  chartEmpty: document.querySelector("#chart-empty"),
  chartContent: document.querySelector("#chart-content"),
  chartTitle: document.querySelector("#chart-title"),
  wowheadLink: document.querySelector("#wowhead-link"),
  chartSubtitle: document.querySelector("#chart-subtitle"),
  selectedTradingMetrics: document.querySelector("#selected-trading-metrics"),
  selectedRoi: document.querySelector("#selected-roi"),
  selectedProfit: document.querySelector("#selected-profit"),
  selectedSwingRois: document.querySelector("#selected-swing-rois"),
  selectedThresholds: document.querySelector("#selected-thresholds"),
  metricSelect: document.querySelector("#metric-select"),
  chart: document.querySelector("#chart"),
  tooltip: document.querySelector("#chart-tooltip"),
  feeInput: document.querySelector("#fee-input"),
  roiInput: document.querySelector("#roi-input"),
  maxRoiInput: document.querySelector("#max-roi-input"),
  profitInput: document.querySelector("#profit-input"),
  maxProfitInput: document.querySelector("#max-profit-input"),
  observationsInput: document.querySelector("#observations-input"),
  minSwingsInput: document.querySelector("#min-swings-input"),
  minSwingRoiInput: document.querySelector("#min-swing-roi-input"),
  minStockInput: document.querySelector("#min-stock-input"),
  maxGapInput: document.querySelector("#max-gap-input"),
  maxSwingCvInput: document.querySelector("#max-swing-cv-input"),
  candidateRows: document.querySelector("#candidate-rows"),
  candidateStatus: document.querySelector("#candidate-status"),
  watchlistRows: document.querySelector("#watchlist-rows"),
  watchlistCount: document.querySelector("#watchlist-count"),
  watchlistStatus: document.querySelector("#watchlist-status"),
  backtestHorizon: document.querySelector("#backtest-horizon"),
  backtestTrades: document.querySelector("#backtest-trades"),
  backtestWinRate: document.querySelector("#backtest-win-rate"),
  backtestAverageRoi: document.querySelector("#backtest-average-roi"),
  backtestAverageProfit: document.querySelector("#backtest-average-profit"),
  backtestAverageHold: document.querySelector("#backtest-average-hold"),
  backtestDrawdown: document.querySelector("#backtest-drawdown"),
  backtestStatus: document.querySelector("#backtest-status"),
  backtestRows: document.querySelector("#backtest-rows"),
};

let scans = [];
let selectedItemId = null;
let selectedMetric = "lowestBuyout";
let itemCatalog = [];
let itemHistory = new Map();
let watchlist = [];
let suggestionItems = [];
let activeSuggestion = -1;

function formatTimestamp(timestamp) {
  return dateFormat.format(new Date(timestamp));
}

function validateData(data) {
  if (!data || !Array.isArray(data.scans) || data.scans.length === 0) {
    throw new Error("Die Scandatei enthält keine gültigen Scans.");
  }
  const seenTimestamps = new Set();
  for (const scan of data.scans) {
    if (!scan || typeof scan.timestamp !== "string" || !Array.isArray(scan.items)) {
      throw new Error("Die Scandatei enthält einen ungültigen Scan-Eintrag.");
    }
    if (Number.isNaN(Date.parse(scan.timestamp)) || seenTimestamps.has(scan.timestamp)) {
      throw new Error(`Ungültiger oder doppelter Zeitstempel: ${scan.timestamp}`);
    }
    seenTimestamps.add(scan.timestamp);
    for (const item of scan.items) {
      if (!REQUIRED_ITEM_FIELDS.every((field) => Object.hasOwn(item, field))) {
        throw new Error(`Ein Item in ${scan.timestamp} enthält nicht alle erforderlichen Felder.`);
      }
    }
  }
  scans = [...data.scans].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  const itemsById = new Map();
  itemHistory = new Map();
  for (const scan of scans) {
    for (const item of scan.items) {
      itemsById.set(item.itemID, item);
      if (!itemHistory.has(item.itemID)) itemHistory.set(item.itemID, []);
      itemHistory.get(item.itemID).push({ timestamp: scan.timestamp, item });
    }
  }
  itemCatalog = [...itemsById.values()];
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function quantile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function getTradingSettings() {
  return {
    feeRate: Number(elements.feeInput.value) / 100,
    minimumRoi: Number(elements.roiInput.value) / 100,
    maximumRoi: elements.maxRoiInput.value.trim() === "" ? null : Number(elements.maxRoiInput.value) / 100,
    minimumProfit: Number(elements.profitInput.value),
    maximumProfit: elements.maxProfitInput.value.trim() === "" ? null : Number(elements.maxProfitInput.value),
    minimumObservations: Number(elements.observationsInput.value),
    minimumSwings: Number(elements.minSwingsInput.value),
    minimumSwingRoi: Number(elements.minSwingRoiInput.value) / 100,
    minimumStock: Number(elements.minStockInput.value),
    maximumGapHours: Number(elements.maxGapInput.value),
    maximumSwingCv: Number(elements.maxSwingCvInput.value) / 100,
  };
}

function getSwingStats(history, feeRate, minimumSwingRoi) {
  const timedHistory = history.map((entry) => ({
    ...entry,
    time: Date.parse(entry.timestamp),
  }));
  const scanGaps = timedHistory.slice(1).map((entry, index) => (entry.time - timedHistory[index].time) / 3600000);
  const maximumGapHours = scanGaps.length ? Math.max(...scanGaps) : 0;
  const stockQuantile = quantile(history.map(({ item }) => item.availableQuantity), 0.25);
  const factor = (1 + minimumSwingRoi) / (1 - feeRate);
  const points = timedHistory.filter(({ item }) => item.lowestBuyout > 0);
  const swings = [];
  if (points.length < 3) return { swings, stockQuantile, maximumGapHours, medianSwingRoi: null, timingCv: null };

  let direction = 0;
  let low = points[0];
  let peak = points[0];
  let trough = points[0];
  let confirmedHigh = null;
  for (const point of points.slice(1)) {
    if (direction === 0) {
      if (point.item.lowestBuyout <= low.item.lowestBuyout) {
        low = point;
        peak = point;
      } else if (point.item.lowestBuyout >= low.item.lowestBuyout * factor) {
        direction = 1;
        peak = point;
      }
    } else if (direction === 1) {
      if (point.item.lowestBuyout >= peak.item.lowestBuyout) {
        peak = point;
      } else if (point.item.lowestBuyout <= peak.item.lowestBuyout / factor) {
        confirmedHigh = peak;
        direction = -1;
        trough = point;
      }
    } else if (point.item.lowestBuyout <= trough.item.lowestBuyout) {
      trough = point;
    } else if (point.item.lowestBuyout >= trough.item.lowestBuyout * factor) {
      const netSwingRoi = (confirmedHigh.item.lowestBuyout * (1 - feeRate) - low.item.lowestBuyout) / low.item.lowestBuyout;
      const durationHours = (trough.time - low.time) / 3600000;
      if (netSwingRoi >= minimumSwingRoi && durationHours > 0) {
        swings.push({
          netSwingRoi,
          durationHours,
          lowTimestamp: low.timestamp,
          peakTimestamp: confirmedHigh.timestamp,
          confirmationTimestamp: trough.timestamp,
        });
      }
      low = trough;
      direction = 1;
      peak = point;
    }
  }

  const durations = swings.map((swing) => swing.durationHours);
  const averageDuration = durations.length
    ? durations.reduce((total, duration) => total + duration, 0) / durations.length
    : 0;
  const durationVariance = durations.length
    ? durations.reduce((total, duration) => total + (duration - averageDuration) ** 2, 0) / durations.length
    : 0;
  return {
    swings,
    stockQuantile,
    maximumGapHours,
    medianSwingRoi: swings.length ? median(swings.map((swing) => swing.netSwingRoi)) : null,
    timingCv: averageDuration > 0 ? Math.sqrt(durationVariance) / averageDuration : null,
  };
}

function getMarketStats(itemId) {
  const history = itemHistory.get(itemId) ?? [];
  const recent = history.slice(-REFERENCE_WINDOW);
  if (recent.length === 0) return null;
  const latest = recent[recent.length - 1];
  const prices = recent.map(({ item }) => item.medianPrice).filter((price) => price > 0);
  if (prices.length === 0) return null;
  const referencePrice = quantile(prices, 0.25);
  const typicalPrice = median(prices);
  const priceMad = median(prices.map((price) => Math.abs(price - typicalPrice)));
  const priceVariation = typicalPrice > 0 ? priceMad / typicalPrice : 1;
  const previous = history.length > 1 ? history[history.length - 2] : null;
  const ageHours = Math.max(0, (Date.now() - Date.parse(latest.timestamp)) / 3600000);
  const settings = getTradingSettings();
  const maximumBuyPrice = settings.minimumRoi >= 0 && settings.feeRate < 1
    ? Math.floor(referencePrice * (1 - settings.feeRate) / (1 + settings.minimumRoi))
    : 0;
  const netProfit = Math.floor(referencePrice * (1 - settings.feeRate) - latest.item.lowestBuyout);
  const roi = latest.item.lowestBuyout > 0
    ? netProfit / latest.item.lowestBuyout
    : Number.NEGATIVE_INFINITY;
  const inventoryChange = previous && previous.item.availableQuantity > 0
    ? (latest.item.availableQuantity - previous.item.availableQuantity) / previous.item.availableQuantity
    : null;
  const averageMedianRatio = latest.item.medianPrice > 0
    ? latest.item.averagePrice / latest.item.medianPrice
    : Number.POSITIVE_INFINITY;
  const swingStats = getSwingStats(history, settings.feeRate, settings.minimumSwingRoi);
  return {
    history,
    recent,
    latest,
    referencePrice,
    priceVariation,
    ageHours,
    maximumBuyPrice,
    netProfit,
    roi,
    inventoryChange,
    averageMedianRatio,
    ...swingStats,
    observationCount: history.length,
    isStable: priceVariation <= 0.3,
    isFresh: ageHours <= MAX_DATA_AGE_HOURS,
  };
}

function appendEmptyRow(tbody, message, colspan) {
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.className = "empty-row";
  cell.colSpan = colspan;
  cell.textContent = message;
  row.append(cell);
  tbody.append(row);
}

function createItemButton(item, { scrollToChart = false } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "item-link";
  button.textContent = item.itemName;
  button.title = "Preisverlauf anzeigen";
  button.addEventListener("click", () => selectItem(item, { scrollToChart }));
  return button;
}

function formatPercent(value) {
  return `${numberFormat.format(value * 100)}%`;
}

function renderCandidates() {
  const settings = getTradingSettings();
  const feeValid = Number.isFinite(settings.feeRate) && settings.feeRate >= 0 && settings.feeRate < 1;
  const settingsValid = feeValid
    && Number.isFinite(settings.minimumRoi) && settings.minimumRoi >= 0
    && (settings.maximumRoi === null || (Number.isFinite(settings.maximumRoi) && settings.maximumRoi >= settings.minimumRoi))
    && Number.isSafeInteger(settings.minimumProfit) && settings.minimumProfit >= 0
    && (settings.maximumProfit === null || (Number.isSafeInteger(settings.maximumProfit) && settings.maximumProfit >= settings.minimumProfit))
    && Number.isInteger(settings.minimumObservations) && settings.minimumObservations >= 1;
  elements.candidateRows.replaceChildren();
  if (!settingsValid) {
    appendEmptyRow(elements.candidateRows, "Bitte gültige Filter eingeben. Obergrenzen müssen mindestens so hoch wie die jeweilige Untergrenze sein.", 13);
    elements.candidateStatus.textContent = "Die Gebühr muss unter 100 % liegen; Beträge in Kupfer und Bestandsgrenzen müssen ganze, nicht-negative Werte sein.";
    renderSelectedTradingMetrics();
    return;
  }

  const candidates = itemCatalog.flatMap((item) => {
    const stats = getMarketStats(item.itemID);
    if (!stats
      || stats.observationCount < settings.minimumObservations
      || stats.latest.item.lowestBuyout <= 0
      || stats.maximumBuyPrice < stats.latest.item.lowestBuyout
      || stats.netProfit < settings.minimumProfit
      || (settings.maximumProfit !== null && stats.netProfit > settings.maximumProfit)
      || stats.roi < settings.minimumRoi
      || (settings.maximumRoi !== null && stats.roi > settings.maximumRoi)
      || stats.swings.length < settings.minimumSwings
      || stats.medianSwingRoi < settings.minimumSwingRoi
      || stats.stockQuantile < settings.minimumStock
      || stats.maximumGapHours > settings.maximumGapHours
      || stats.timingCv === null
      || stats.timingCv > settings.maximumSwingCv) return [];
    return [{ item, stats }];
  }).sort((left, right) => right.stats.netProfit - left.stats.netProfit);

  for (const { item, stats } of candidates.slice(0, MAX_CANDIDATES)) {
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");
    nameCell.append(createItemButton(item, { scrollToChart: true }));
    const id = document.createElement("small");
    id.textContent = `ID ${item.itemID}`;
    nameCell.append(id);

    const lowestCell = document.createElement("td");
    lowestCell.textContent = formatMoney(stats.latest.item.lowestBuyout);
    const referenceCell = document.createElement("td");
    referenceCell.textContent = formatMoney(stats.referencePrice);
    const buyCell = document.createElement("td");
    buyCell.textContent = formatMoney(stats.maximumBuyPrice);
    const profitCell = document.createElement("td");
    profitCell.textContent = `${formatMoney(stats.netProfit)} / ${formatPercent(stats.roi)}`;
    const stockCell = document.createElement("td");
    stockCell.textContent = numberFormat.format(stats.latest.item.availableQuantity);
    const stockTrend = document.createElement("small");
    stockTrend.textContent = stats.inventoryChange === null
      ? "Trend nicht verfügbar"
      : `Bestand ${stats.inventoryChange > 0 ? "+" : ""}${formatPercent(stats.inventoryChange)}`;
    stockCell.append(stockTrend);
    const swingCountCell = document.createElement("td");
    swingCountCell.textContent = numberFormat.format(stats.swings.length);
    const swingRoiCell = document.createElement("td");
    swingRoiCell.textContent = formatPercent(stats.medianSwingRoi);
    const timingCvCell = document.createElement("td");
    timingCvCell.textContent = formatPercent(stats.timingCv);
    const stockQuantileCell = document.createElement("td");
    stockQuantileCell.textContent = numberFormat.format(stats.stockQuantile);
    const maxGapCell = document.createElement("td");
    maxGapCell.textContent = `${numberFormat.format(stats.maximumGapHours)} Std.`;
    const confidenceCell = document.createElement("td");
    const averageIsOutlier = stats.averageMedianRatio > 2 || stats.averageMedianRatio < 0.5;
    const confidenceLabel = stats.isFresh && stats.observationCount >= Math.max(settings.minimumObservations, 5) && stats.isStable && !averageIsOutlier
      ? "Gut"
      : stats.isFresh && stats.observationCount >= settings.minimumObservations
        ? "Mittel"
        : "Schwach";
    confidenceCell.textContent = `${confidenceLabel} · ${stats.observationCount} Scans`;
    const confidenceDetail = document.createElement("small");
    const vendorDownside = Math.max(0, stats.latest.item.lowestBuyout - stats.latest.item.vendorSellPrice);
    confidenceDetail.textContent = `MAD ${formatPercent(stats.priceVariation)} · Ø/Median ${numberFormat.format(stats.averageMedianRatio)}${averageIsOutlier ? " (Ausreißer)" : ""} · Vendor-Risiko ${formatMoney(vendorDownside)} · ${numberFormat.format(stats.ageHours)} Std. alt`;
    confidenceCell.append(confidenceDetail);
    const actionCell = document.createElement("td");
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "table-action";
    const alreadyWatching = watchlist.some((entry) => entry.itemID === item.itemID);
    addButton.textContent = alreadyWatching ? "Auf Watchlist" : "Merken";
    addButton.disabled = alreadyWatching;
    addButton.addEventListener("click", () => addToWatchlist(item, stats));
    actionCell.append(addButton);
    row.append(nameCell, lowestCell, referenceCell, buyCell, profitCell, stockCell, swingCountCell, swingRoiCell, timingCvCell, stockQuantileCell, maxGapCell, confidenceCell, actionCell);
    elements.candidateRows.append(row);
  }

  const filterSummary = `Filter: mind. ${settings.minimumSwings} bestätigte Schwankungen mit ${formatPercent(settings.minimumSwingRoi)} Netto-Swing-ROI · Bestand Q25 mind. ${numberFormat.format(settings.minimumStock)} · max. Scan-Abstand ${numberFormat.format(settings.maximumGapHours)} Std. · Zyklus-Zeit-CV max. ${formatPercent(settings.maximumSwingCv)}.`;
  elements.candidateStatus.textContent = candidates.length === 0
    ? `Keine Kandidaten erfüllen derzeit die Handels- und Schwankungsfilter. ${filterSummary}`
    : `${candidates.length} Kandidaten gefunden${candidates.length > MAX_CANDIDATES ? ` · erste ${MAX_CANDIDATES} nach erwartetem Netto-Gewinn angezeigt` : ""}. Gewinnschätzung gilt pro Stück und unterstellt den Verkauf zum konservativen Referenzpreis. ${filterSummary}`;
  renderSelectedTradingMetrics();
}

function loadWatchlist() {
  try {
    const saved = localStorage.getItem(WATCHLIST_STORAGE_KEY);
    if (saved === null) return;
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed) || parsed.some((entry) =>
      !entry
      || !Number.isInteger(entry.itemID)
      || !Number.isFinite(entry.buyTarget)
      || entry.buyTarget < 0
      || !Number.isFinite(entry.sellTarget)
      || entry.sellTarget < 0)) {
      throw new Error("Die gespeicherte Watchlist hat ein ungültiges Format.");
    }
    watchlist = parsed.filter((entry) => itemHistory.has(entry.itemID));
  } catch (error) {
    elements.watchlistStatus.classList.add("error-text");
    elements.watchlistStatus.textContent = error instanceof Error
      ? `Watchlist konnte nicht geladen werden: ${error.message}`
      : "Watchlist konnte nicht geladen werden.";
  }
}

function saveWatchlist() {
  try {
    localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(watchlist));
    elements.watchlistStatus.classList.remove("error-text");
    elements.watchlistStatus.textContent = "Watchlist in diesem Browser gespeichert.";
    return true;
  } catch (error) {
    elements.watchlistStatus.classList.add("error-text");
    elements.watchlistStatus.textContent = error instanceof Error
      ? `Watchlist konnte nicht gespeichert werden: ${error.message}`
      : "Watchlist konnte nicht gespeichert werden.";
    return false;
  }
}

function addToWatchlist(item, stats) {
  if (watchlist.some((entry) => entry.itemID === item.itemID)) return;
  watchlist.push({
    itemID: item.itemID,
    buyTarget: stats.maximumBuyPrice,
    sellTarget: Math.round(stats.referencePrice),
  });
  saveWatchlist();
  renderMarketViews();
}

function createTargetInput(entry, field, label) {
  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.step = "1";
  input.value = String(entry[field]);
  input.setAttribute("aria-label", `${label} für ${itemCatalog.find((item) => item.itemID === entry.itemID)?.itemName ?? entry.itemID} in Kupfer`);
  input.addEventListener("change", () => {
    const value = Number(input.value);
    if (!Number.isSafeInteger(value) || value < 0) {
      elements.watchlistStatus.classList.add("error-text");
      elements.watchlistStatus.textContent = "Kauf- und Verkaufsziele müssen nicht-negative ganze Kupferwerte sein.";
      input.value = String(entry[field]);
      return;
    }
    entry[field] = value;
    saveWatchlist();
    renderWatchlist();
  });
  return input;
}

function renderWatchlist() {
  elements.watchlistRows.replaceChildren();
  elements.watchlistCount.textContent = String(watchlist.length);
  if (watchlist.length === 0) {
    appendEmptyRow(elements.watchlistRows, "Noch keine Items gespeichert. Kandidaten über „Merken“ hinzufügen.", 6);
    return;
  }
  for (const entry of watchlist) {
    const item = itemCatalog.find((candidate) => candidate.itemID === entry.itemID);
    const stats = getMarketStats(entry.itemID);
    if (!item || !stats) continue;
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");
    nameCell.append(createItemButton(item));
    const lowestCell = document.createElement("td");
    lowestCell.textContent = formatMoney(stats.latest.item.lowestBuyout);
    const buyCell = document.createElement("td");
    buyCell.append(createTargetInput(entry, "buyTarget", "Kauflimit"));
    const sellCell = document.createElement("td");
    sellCell.append(createTargetInput(entry, "sellTarget", "Verkaufsziel"));
    const signalCell = document.createElement("td");
    const signal = document.createElement("span");
    const buyReached = stats.latest.item.lowestBuyout > 0 && stats.latest.item.lowestBuyout <= entry.buyTarget;
    const targetReachable = entry.sellTarget * (1 - getTradingSettings().feeRate) > entry.buyTarget;
    signal.className = `signal ${buyReached && targetReachable ? "good" : targetReachable ? "watch" : "weak"}`;
    const expectedTargetRoi = entry.buyTarget > 0
      ? (entry.sellTarget * (1 - getTradingSettings().feeRate) - entry.buyTarget) / entry.buyTarget
      : Number.POSITIVE_INFINITY;
    const targetRoiLabel = entry.buyTarget > 0 ? formatPercent(expectedTargetRoi) : "ROI n/a";
    signal.textContent = !targetReachable
      ? "Ziel nicht profitabel"
      : buyReached
        ? `Limit im letzten Scan erreicht · ${targetRoiLabel}`
        : `Beobachten · ${targetRoiLabel}`;
    signalCell.append(signal);
    const actionCell = document.createElement("td");
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "table-action";
    removeButton.textContent = "Entfernen";
    removeButton.setAttribute("aria-label", `${item.itemName} von der Watchlist entfernen`);
    removeButton.addEventListener("click", () => {
      watchlist = watchlist.filter((candidate) => candidate.itemID !== entry.itemID);
      saveWatchlist();
      renderMarketViews();
    });
    actionCell.append(removeButton);
    row.append(nameCell, lowestCell, buyCell, sellCell, signalCell, actionCell);
    elements.watchlistRows.append(row);
  }
}

function renderMarketViews() {
  renderCandidates();
  renderWatchlist();
  renderBacktest();
}

function simulateItemBacktest(item, settings, horizon) {
  const history = itemHistory.get(item.itemID) ?? [];
  const referenceWindow = Math.max(REFERENCE_WINDOW, settings.minimumObservations);
  const trades = [];
  let incompleteSignals = 0;
  let index = settings.minimumObservations;

  while (index < history.length) {
    const entry = history[index];
    const referencePrices = history
      .slice(Math.max(0, index - referenceWindow), index)
      .map(({ item: observed }) => observed.medianPrice)
      .filter((price) => price > 0);
    if (referencePrices.length < settings.minimumObservations || entry.item.lowestBuyout <= 0) {
      index += 1;
      continue;
    }

    const buyReference = quantile(referencePrices, 0.25);
    const buyPriceLimit = Math.floor(buyReference * (1 - settings.feeRate) / (1 + settings.minimumRoi));
    const expectedProfit = Math.floor(buyReference * (1 - settings.feeRate) - entry.item.lowestBuyout);
    const expectedRoi = expectedProfit / entry.item.lowestBuyout;
    if (entry.item.lowestBuyout > buyPriceLimit
      || expectedProfit < settings.minimumProfit
      || (settings.maximumProfit !== null && expectedProfit > settings.maximumProfit)
      || (settings.maximumRoi !== null && expectedRoi > settings.maximumRoi)) {
      index += 1;
      continue;
    }

    const finalExitIndex = Math.min(index + horizon, history.length - 1);
    if (finalExitIndex - index < horizon) {
      incompleteSignals += 1;
      index += 1;
      continue;
    }

    let exitIndex = finalExitIndex;
    let exitReference = 0;
    let targetReached = false;
    let maxAdverseExcursion = 0;
    for (let futureIndex = index + 1; futureIndex <= finalExitIndex; futureIndex += 1) {
      const future = history[futureIndex];
      const observedPrices = history
        .slice(Math.max(0, futureIndex - referenceWindow + 1), futureIndex + 1)
        .map(({ item: observed }) => observed.medianPrice)
        .filter((price) => price > 0);
      const conservativePrice = quantile(observedPrices, 0.25);
      if (future.item.lowestBuyout > 0) {
        maxAdverseExcursion = Math.max(
          maxAdverseExcursion,
          Math.max(0, (entry.item.lowestBuyout - future.item.lowestBuyout) / entry.item.lowestBuyout),
        );
      }
      const netProfit = Math.floor(conservativePrice * (1 - settings.feeRate) - entry.item.lowestBuyout);
      const netRoi = netProfit / entry.item.lowestBuyout;
      exitIndex = futureIndex;
      exitReference = conservativePrice;
      if (netRoi >= settings.minimumRoi) {
        targetReached = true;
        break;
      }
    }

    const netProfit = Math.floor(exitReference * (1 - settings.feeRate) - entry.item.lowestBuyout);
    trades.push({
      netProfit,
      roi: netProfit / entry.item.lowestBuyout,
      holdingHours: (Date.parse(history[exitIndex].timestamp) - Date.parse(entry.timestamp)) / 3600000,
      maxAdverseExcursion,
      targetReached,
    });
    index = exitIndex + 1;
  }

  if (trades.length === 0) return { trades, incompleteSignals };
  const totalProfit = trades.reduce((total, trade) => total + trade.netProfit, 0);
  return {
    trades,
    incompleteSignals,
    totalProfit,
    profitableTrades: trades.filter((trade) => trade.netProfit > 0).length,
    targetTrades: trades.filter((trade) => trade.targetReached).length,
    averageRoi: trades.reduce((total, trade) => total + trade.roi, 0) / trades.length,
    averageHoldingHours: trades.reduce((total, trade) => total + trade.holdingHours, 0) / trades.length,
    maxAdverseExcursion: Math.max(...trades.map((trade) => trade.maxAdverseExcursion)),
  };
}

function renderBacktest() {
  const settings = getTradingSettings();
  const horizon = Number(elements.backtestHorizon.value);
  const validSettings = Number.isFinite(settings.feeRate)
    && settings.feeRate >= 0 && settings.feeRate < 1
    && Number.isFinite(settings.minimumRoi) && settings.minimumRoi >= 0
    && (settings.maximumRoi === null || (Number.isFinite(settings.maximumRoi) && settings.maximumRoi >= settings.minimumRoi))
    && Number.isSafeInteger(settings.minimumProfit) && settings.minimumProfit >= 0
    && (settings.maximumProfit === null || (Number.isSafeInteger(settings.maximumProfit) && settings.maximumProfit >= settings.minimumProfit))
    && Number.isInteger(settings.minimumObservations) && settings.minimumObservations >= 1
    && Number.isInteger(settings.minimumSwings) && settings.minimumSwings >= 1
    && Number.isFinite(settings.minimumSwingRoi) && settings.minimumSwingRoi >= 0
    && Number.isSafeInteger(settings.minimumStock) && settings.minimumStock >= 0
    && Number.isFinite(settings.maximumGapHours) && settings.maximumGapHours > 0
    && Number.isFinite(settings.maximumSwingCv) && settings.maximumSwingCv >= 0;
  elements.backtestRows.replaceChildren();
  if (!validSettings || !Number.isInteger(horizon) || horizon < 1 || horizon >= scans.length) {
    appendEmptyRow(elements.backtestRows, "Bitte gültige Handelsfilter und eine Haltedauer kleiner als die Scan-Anzahl eingeben.", 7);
    elements.backtestStatus.textContent = "";
    elements.backtestTrades.textContent = "–";
    elements.backtestWinRate.textContent = "–";
    elements.backtestAverageRoi.textContent = "–";
    elements.backtestAverageProfit.textContent = "–";
    elements.backtestAverageHold.textContent = "–";
    elements.backtestDrawdown.textContent = "–";
    return;
  }

  const simulations = itemCatalog
    .map((item) => ({ item, ...simulateItemBacktest(item, settings, horizon) }));
  const results = simulations
    .filter(({ trades }) => trades.length > 0)
    .sort((left, right) => right.totalProfit - left.totalProfit);
  const allTrades = results.flatMap(({ trades }) => trades);
  const totalProfit = allTrades.reduce((total, trade) => total + trade.netProfit, 0);
  const profitableTrades = allTrades.filter((trade) => trade.netProfit > 0).length;
  const incompleteSignals = simulations.reduce((total, result) => total + result.incompleteSignals, 0);

  elements.backtestTrades.textContent = numberFormat.format(allTrades.length);
  elements.backtestWinRate.textContent = allTrades.length
    ? formatPercent(profitableTrades / allTrades.length)
    : "–";
  elements.backtestAverageRoi.textContent = allTrades.length
    ? formatPercent(allTrades.reduce((total, trade) => total + trade.roi, 0) / allTrades.length)
    : "–";
  elements.backtestAverageProfit.textContent = allTrades.length
    ? formatSignedMoney(Math.round(totalProfit / allTrades.length))
    : "–";
  elements.backtestAverageHold.textContent = allTrades.length
    ? `${numberFormat.format(allTrades.reduce((total, trade) => total + trade.holdingHours, 0) / allTrades.length)} Std.`
    : "–";
  elements.backtestDrawdown.textContent = allTrades.length
    ? formatPercent(Math.max(...allTrades.map((trade) => trade.maxAdverseExcursion)))
    : "–";

  for (const { item, trades, totalProfit: itemProfit, profitableTrades: itemWinners, targetTrades, averageRoi, averageHoldingHours, maxAdverseExcursion } of results.slice(0, MAX_CANDIDATES)) {
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");
    nameCell.append(createItemButton(item, { scrollToChart: true }));
    const tradeCell = document.createElement("td");
    tradeCell.textContent = numberFormat.format(trades.length);
    const winCell = document.createElement("td");
    winCell.textContent = `${formatPercent(itemWinners / trades.length)} (${targetTrades} Ziel)`;
    const roiCell = document.createElement("td");
    roiCell.textContent = formatPercent(averageRoi);
    const profitCell = document.createElement("td");
    profitCell.textContent = formatSignedMoney(itemProfit);
    const holdCell = document.createElement("td");
    holdCell.textContent = `${numberFormat.format(averageHoldingHours)} Std.`;
    const drawdownCell = document.createElement("td");
    drawdownCell.textContent = formatPercent(maxAdverseExcursion);
    row.append(nameCell, tradeCell, winCell, roiCell, profitCell, holdCell, drawdownCell);
    elements.backtestRows.append(row);
  }

  if (results.length === 0) {
    appendEmptyRow(elements.backtestRows, "Mit diesen Filtern wurden keine vollständig auswertbaren Kaufgelegenheiten gefunden.", 7);
  }
  elements.backtestStatus.textContent = `${results.length} Items mit mindestens einem vollständigen Trade${results.length > MAX_CANDIDATES ? ` · erste ${MAX_CANDIDATES} nach Gesamtgewinn angezeigt` : ""} · ${numberFormat.format(incompleteSignals)} Kaufsignale nahe dem Datenende wegen fehlender Haltedauer ausgeschlossen. Kauflimit: Q25 der bis dahin bekannten Medianpreise; Verkauf: erster Folge-Scan mit mindestens dem eingestellten Mindest-ROI, sonst Bewertung am Horizont. Gesamtgewinn ${formatSignedMoney(totalProfit)} über alle simulierten Trades.`;
}

function showSuggestions() {
  const query = elements.search.value.trim().toLocaleLowerCase("de");
  activeSuggestion = -1;
  if (query.length < 2) {
    elements.suggestions.hidden = true;
    elements.search.setAttribute("aria-expanded", "false");
    elements.searchHint.textContent = "Items aus allen Scans durchsuchen.";
    return;
  }
  suggestionItems = itemCatalog
    .filter((item) => item.itemName.toLocaleLowerCase("de").includes(query))
    .sort((left, right) => left.itemName.localeCompare(right.itemName, "de") || left.itemID - right.itemID);
  elements.suggestions.replaceChildren();
  for (const [index, item] of suggestionItems.entries()) {
    const row = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "suggestion";
    button.setAttribute("role", "option");
    button.id = `suggestion-${index}`;
    button.setAttribute("aria-selected", "false");
    const name = document.createElement("span");
    name.textContent = item.itemName;
    const detail = document.createElement("small");
    detail.textContent = `Item-ID ${item.itemID}`;
    button.append(name, detail);
    button.addEventListener("click", () => selectItem(item));
    row.append(button);
    elements.suggestions.append(row);
  }
  const hasResults = suggestionItems.length > 0;
  elements.suggestions.hidden = !hasResults;
  elements.search.setAttribute("aria-expanded", String(hasResults));
  elements.searchHint.textContent = hasResults
    ? `${suggestionItems.length} Vorschläge`
    : "Keine passenden Items gefunden.";
}

function selectItem(item, { scrollToChart = false } = {}) {
  selectedItemId = item.itemID;
  elements.search.value = item.itemName;
  elements.suggestions.hidden = true;
  elements.search.setAttribute("aria-expanded", "false");
  elements.searchHint.textContent = `Item-ID ${item.itemID}`;
  renderChart();
  if (scrollToChart) {
    elements.chartPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function renderChart() {
  elements.tooltip.hidden = true;
  if (selectedItemId === null) {
    elements.chartContent.hidden = true;
    elements.chartEmpty.hidden = false;
    return;
  }
  const points = scans.flatMap((scan) => {
    const item = scan.items.find((entry) => entry.itemID === selectedItemId);
    return item ? [{ timestamp: scan.timestamp, item }] : [];
  });
  if (points.length === 0) {
    selectedItemId = null;
    elements.chartContent.hidden = true;
    elements.chartEmpty.hidden = false;
    return;
  }

  elements.chartEmpty.hidden = true;
  elements.chartContent.hidden = false;
  elements.chartTitle.textContent = points[0].item.itemName;
  elements.wowheadLink.href = `https://www.wowhead.com/forever/de/item=${selectedItemId}`;
  elements.wowheadLink.setAttribute("aria-label", `Wowhead-Datenbank für ${points[0].item.itemName} in neuem Tab öffnen`);
  elements.chartSubtitle.textContent = `Item-ID ${selectedItemId} · ${points.length} ${points.length === 1 ? "Messpunkt" : "Messpunkte"} · Vendor Sell Price ${formatMoney(points[0].item.vendorSellPrice)}`;
  elements.metricSelect.value = selectedMetric;
  renderSelectedTradingMetrics();
  drawChart(points);
}

function formatSignedMoney(value) {
  return `${value < 0 ? "−" : ""}${formatMoney(Math.abs(value))}`;
}

function renderSelectedTradingMetrics() {
  if (selectedItemId === null) {
    elements.selectedTradingMetrics.hidden = true;
    return;
  }
  const stats = getMarketStats(selectedItemId);
  if (!stats) {
    elements.selectedTradingMetrics.hidden = false;
    elements.selectedRoi.textContent = "Nicht verfügbar";
    elements.selectedProfit.textContent = "Nicht verfügbar";
    elements.selectedSwingRois.textContent = "Nicht verfügbar";
    elements.selectedThresholds.textContent = "Für dieses Item liegen keine ausreichenden Preisdaten vor.";
    return;
  }
  const settings = getTradingSettings();
  elements.selectedTradingMetrics.hidden = false;
  elements.selectedRoi.textContent = Number.isFinite(stats.roi) ? formatPercent(stats.roi) : "Nicht verfügbar";
  elements.selectedProfit.textContent = formatSignedMoney(stats.netProfit);
  elements.selectedSwingRois.replaceChildren();
  if (stats.swings.length === 0) {
    elements.selectedSwingRois.textContent = "Keine passenden abgeschlossenen Zyklen";
  } else {
    for (const swing of stats.swings) {
      const value = document.createElement("strong");
      value.className = "swing-roi-value";
      value.textContent = `${swingPercentFormat.format(swing.netSwingRoi * 100)}%`;
      value.title = `Tief ${formatTimestamp(swing.lowTimestamp)} · Hoch ${formatTimestamp(swing.peakTimestamp)} · Zyklus bestätigt ${formatTimestamp(swing.confirmationTimestamp)}`;
      elements.selectedSwingRois.append(value);
    }
  }
  const roiLimit = settings.maximumRoi === null
    ? `${formatPercent(settings.minimumRoi)} bis ohne Obergrenze`
    : `${formatPercent(settings.minimumRoi)} bis ${formatPercent(settings.maximumRoi)}`;
  const profitLimit = settings.maximumProfit === null
    ? `${formatMoney(settings.minimumProfit)} bis ohne Obergrenze`
    : `${formatMoney(settings.minimumProfit)} bis ${formatMoney(settings.maximumProfit)}`;
  elements.selectedThresholds.textContent = `Aktive Handelsfilter: ROI ${roiLimit} · Nettogewinn ${profitLimit} pro Stück.`;
}

function drawChart(points) {
  const margin = { top: 22, right: 22, bottom: 82, left: 110 };
  const width = Math.max(elements.chart.clientWidth, 680, points.length * 58 + margin.left + margin.right);
  const height = 390;
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const metric = CHART_METRICS[selectedMetric];
  const maxValue = Math.max(...points.map(({ item }) => item[selectedMetric]), 1);
  const minTime = Date.parse(scans[0].timestamp);
  const maxTime = Date.parse(scans[scans.length - 1].timestamp);
  const timestampRange = maxTime - minTime;
  const x = (timestamp) => margin.left + (maxTime === minTime
    ? plotWidth / 2
    : ((Date.parse(timestamp) - minTime) / timestampRange) * plotWidth);
  const y = (value) => margin.top + plotHeight - (value / maxValue) * plotHeight;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.style.width = `${width}px`;
  svg.setAttribute("aria-label", `${metric.label} Verlauf für ${points[0].item.itemName}`);

  for (let tick = 0; tick <= 4; tick += 1) {
    const value = maxValue * tick / 4;
    const tickY = y(value);
    svg.append(svgElement("line", { x1: margin.left, x2: width - margin.right, y1: tickY, y2: tickY, class: "grid-line" }));
    svg.append(svgElement("text", { x: margin.left - 10, y: tickY + 4, "text-anchor": "end", class: "axis-label" }, formatMetricValue(value, metric.format)));
  }
  svg.append(svgElement("text", { x: 15, y: margin.top + plotHeight / 2, transform: `rotate(-90 15 ${margin.top + plotHeight / 2})`, class: "axis-title" }, metric.label));
  svg.append(svgElement("text", { x: margin.left + plotWidth / 2, y: height - 8, "text-anchor": "middle", class: "axis-title" }, "Zeitpunkt (UTC)"));

  const path = points.map(({ timestamp, item }, index) => `${index === 0 ? "M" : "L"} ${x(timestamp)} ${y(item[selectedMetric])}`).join(" ");
  svg.append(svgElement("path", { d: path, class: "price-line" }));
  let previousLabelX = Number.NEGATIVE_INFINITY;
  points.forEach((point, index) => {
    const pointX = x(point.timestamp);
    const pointY = y(point.item[selectedMetric]);
    const dateParts = new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      timeZone: "UTC",
    }).format(new Date(point.timestamp));
    const timeParts = new Intl.DateTimeFormat("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(new Date(point.timestamp));
    const isLastPoint = index === points.length - 1;
    if (index === 0 || isLastPoint || pointX - previousLabelX >= 64) {
      const label = svgElement("text", { x: pointX, y: margin.top + plotHeight + 24, "text-anchor": "middle", class: "axis-label" });
      label.append(svgElement("tspan", { x: pointX, dy: 0 }, dateParts), svgElement("tspan", { x: pointX, dy: 15 }, timeParts));
      svg.append(label);
      previousLabelX = pointX;
    }
    const circle = svgElement("circle", {
      cx: pointX,
      cy: pointY,
      r: points.length === 1 ? 5 : 4,
      class: "price-point",
      tabindex: 0,
      role: "button",
      "aria-label": `${formatTimestamp(point.timestamp)}, ${metric.label} ${formatMetricValue(point.item[selectedMetric], metric.format)}`,
    });
    circle.addEventListener("mouseenter", (event) => showTooltip(point, event, pointX, pointY));
    circle.addEventListener("mousemove", (event) => positionTooltip(event, pointX, pointY));
    circle.addEventListener("mouseleave", () => { elements.tooltip.hidden = true; });
    circle.addEventListener("focus", (event) => showTooltip(point, event, pointX, pointY));
    circle.addEventListener("blur", () => { elements.tooltip.hidden = true; });
    svg.append(circle);
    if (index === 0 || index === points.length - 1) circle.setAttribute("data-edge", "true");
  });
  elements.chart.replaceChildren(svg);
}

function svgElement(name, attributes, text) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatMoney(value) {
  const copperTotal = Math.trunc(value);
  const gold = Math.floor(copperTotal / 10000);
  const silver = Math.floor(copperTotal / 100) % 100;
  const copper = copperTotal % 100;
  const denominations = [];
  if (gold > 0) denominations.push(`${gold}g`);
  if (silver > 0) denominations.push(`${silver}s`);
  denominations.push(`${copper}c`);
  return denominations.join(" ");
}

function formatMetricValue(value, format) {
  return format === "money" ? formatMoney(value) : numberFormat.format(value);
}

function showTooltip(point, event, pointX, pointY) {
  const rows = [
    [null, "Item ID", numberFormat.format(point.item.itemID)],
    ["availableQuantity", "Available Quantity", numberFormat.format(point.item.availableQuantity)],
    [null, "Vendor Sell Price", formatMoney(point.item.vendorSellPrice)],
    ["averagePrice", "Average Price", formatMoney(point.item.averagePrice)],
    ["medianPrice", "Median Price", formatMoney(point.item.medianPrice)],
    ["lowestBuyout", "Lowest Buyout", formatMoney(point.item.lowestBuyout)],
    ["highestBuyout", "Highest Buyout", formatMoney(point.item.highestBuyout)],
  ];
  elements.tooltip.replaceChildren();
  const heading = document.createElement("div");
  heading.className = "tooltip-heading";
  heading.textContent = formatTimestamp(point.timestamp);
  const grid = document.createElement("div");
  grid.className = "tooltip-grid";
  for (const [metric, label, value] of rows) {
    const title = document.createElement("span");
    title.textContent = label;
    const content = document.createElement("strong");
    content.textContent = value;
    if (metric === selectedMetric) {
      title.classList.add("selected-y-metric");
      content.classList.add("selected-y-metric");
    }
    grid.append(title, content);
  }
  elements.tooltip.append(heading, grid);
  elements.tooltip.hidden = false;
  positionTooltip(event, pointX, pointY);
}

function positionTooltip(event, pointX, pointY) {
  const panel = elements.chartContent.getBoundingClientRect();
  const chartRect = elements.chart.getBoundingClientRect();
  const localX = event?.clientX ? event.clientX - panel.left + 14 : chartRect.left - panel.left + pointX + 12;
  const localY = event?.clientY ? event.clientY - panel.top + 12 : chartRect.top - panel.top + pointY + 12;
  const maxX = elements.chartContent.clientWidth - elements.tooltip.offsetWidth - 10;
  elements.tooltip.style.left = `${Math.max(10, Math.min(localX, maxX))}px`;
  elements.tooltip.style.top = `${Math.max(10, localY)}px`;
}

elements.search.addEventListener("input", showSuggestions);
elements.metricSelect.addEventListener("change", () => {
  selectedMetric = elements.metricSelect.value;
  if (selectedItemId !== null) renderChart();
});
for (const input of [
  elements.feeInput,
  elements.roiInput,
  elements.maxRoiInput,
  elements.profitInput,
  elements.maxProfitInput,
  elements.observationsInput,
  elements.minSwingsInput,
  elements.minSwingRoiInput,
  elements.minStockInput,
  elements.maxGapInput,
  elements.maxSwingCvInput,
  elements.backtestHorizon,
]) {
  input.addEventListener("input", renderMarketViews);
}
elements.search.addEventListener("keydown", (event) => {
  if (elements.suggestions.hidden || suggestionItems.length === 0) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    activeSuggestion = activeSuggestion < 0
      ? (direction > 0 ? 0 : suggestionItems.length - 1)
      : (activeSuggestion + direction + suggestionItems.length) % suggestionItems.length;
    const options = elements.suggestions.querySelectorAll(".suggestion");
    options.forEach((option, index) => option.setAttribute("aria-selected", String(index === activeSuggestion)));
    options[activeSuggestion].focus();
  }
});
elements.search.addEventListener("focus", showSuggestions);
elements.suggestions.addEventListener("keydown", (event) => {
  const option = event.target.closest(".suggestion");
  if (!option) return;
  const index = Number(option.id.replace("suggestion-", ""));
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    activeSuggestion = (index + (event.key === "ArrowDown" ? 1 : -1) + suggestionItems.length) % suggestionItems.length;
    elements.suggestions.querySelectorAll(".suggestion")[activeSuggestion].focus();
  } else if (event.key === "Enter") {
    event.preventDefault();
    selectItem(suggestionItems[index]);
  } else if (event.key === "Escape") {
    elements.suggestions.hidden = true;
    elements.search.focus();
  }
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".search-wrap")) {
    elements.suggestions.hidden = true;
    elements.search.setAttribute("aria-expanded", "false");
  }
});
window.addEventListener("resize", () => {
  if (selectedItemId !== null) renderChart();
});

async function initialize() {
  try {
    const response = await fetch("./scans.json");
    if (!response.ok) throw new Error(`Scandaten konnten nicht geladen werden (HTTP ${response.status}).`);
    validateData(await response.json());
    elements.backtestHorizon.max = String(scans.length - 1);
    elements.scanCount.textContent = `${scans.length} Scans`;
    elements.datasetNote.textContent = `Datenstand: ${formatTimestamp(scans[scans.length - 1].timestamp)} UTC · Swing-Erkennung anhand Lowest Buyout; ROI nach Gebühr. Bestand und Verkauf sind Näherungen aus Angebotssnapshots, keine Verkaufsdaten.`;
    loadWatchlist();
    renderMarketViews();
    elements.workspace.hidden = false;
    elements.loading.hidden = true;
  } catch (error) {
    elements.loading.hidden = true;
    elements.error.textContent = error instanceof Error ? error.message : "Unbekannter Fehler beim Laden der Scandaten.";
    elements.error.hidden = false;
  }
}

initialize();
