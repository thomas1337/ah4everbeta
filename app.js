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

const elements = {
  scanCount: document.querySelector("#scan-count"),
  workspace: document.querySelector("#workspace"),
  loading: document.querySelector("#loading"),
  error: document.querySelector("#error"),
  search: document.querySelector("#item-search"),
  suggestions: document.querySelector("#suggestions"),
  searchHint: document.querySelector("#search-hint"),
  chartEmpty: document.querySelector("#chart-empty"),
  chartContent: document.querySelector("#chart-content"),
  chartTitle: document.querySelector("#chart-title"),
  chartSubtitle: document.querySelector("#chart-subtitle"),
  metricSelect: document.querySelector("#metric-select"),
  chart: document.querySelector("#chart"),
  tooltip: document.querySelector("#chart-tooltip"),
};

let scans = [];
let selectedItemId = null;
let selectedMetric = "lowestBuyout";
let itemCatalog = [];
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
  for (const scan of scans) {
    for (const item of scan.items) {
      itemsById.set(item.itemID, item);
    }
  }
  itemCatalog = [...itemsById.values()];
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
    .sort((left, right) => left.itemName.localeCompare(right.itemName, "de") || left.itemID - right.itemID)
    .slice(0, 10);
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

function selectItem(item) {
  selectedItemId = item.itemID;
  elements.search.value = item.itemName;
  elements.suggestions.hidden = true;
  elements.search.setAttribute("aria-expanded", "false");
  elements.searchHint.textContent = `Item-ID ${item.itemID}`;
  renderChart();
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
  elements.chartSubtitle.textContent = `Item-ID ${selectedItemId} · ${points.length} ${points.length === 1 ? "Messpunkt" : "Messpunkte"} · Vendor Sell Price ${formatMoney(points[0].item.vendorSellPrice)}`;
  elements.metricSelect.value = selectedMetric;
  drawChart(points);
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
    ["Item ID", numberFormat.format(point.item.itemID)],
    ["Available Quantity", numberFormat.format(point.item.availableQuantity)],
    ["Vendor Sell Price", formatMoney(point.item.vendorSellPrice)],
    ["Average Price", formatMoney(point.item.averagePrice)],
    ["Median Price", formatMoney(point.item.medianPrice)],
    ["Lowest Buyout", formatMoney(point.item.lowestBuyout)],
    ["Highest Buyout", formatMoney(point.item.highestBuyout)],
  ];
  elements.tooltip.replaceChildren();
  const heading = document.createElement("div");
  heading.className = "tooltip-heading";
  heading.textContent = formatTimestamp(point.timestamp);
  const grid = document.createElement("div");
  grid.className = "tooltip-grid";
  for (const [label, value] of rows) {
    const title = document.createElement("span");
    title.textContent = label;
    const content = document.createElement("strong");
    content.textContent = value;
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
    elements.scanCount.textContent = `${scans.length} Scans`;
    elements.workspace.hidden = false;
    elements.loading.hidden = true;
  } catch (error) {
    elements.loading.hidden = true;
    elements.error.textContent = error instanceof Error ? error.message : "Unbekannter Fehler beim Laden der Scandaten.";
    elements.error.hidden = false;
  }
}

initialize();
