# App Context

## Purpose and structure

- This folder contains a static German-language auction-house scan viewer for GitHub Pages.
- `index.html`, `styles.css`, and `app.js` are a dependency-free vanilla HTML/CSS/JavaScript app. Preserve relative asset URLs so the app also works when hosted below a repository path.
- `scans.json` is generated data, not the source of truth. The Lua `AHScanDB` files live in the workspace root; `../tools/prepare_scans.py` merges them, sorts scans, removes identical duplicate timestamps, and fails on conflicts.
- Regenerate the dataset from the workspace root with `python .\tools\prepare_scans.py`. Do not hand-edit `scans.json`.

## Data and behavior

- `scans.json` contains `scans`, an ascending array of `{ timestamp, items }`; each item has `itemName`, `itemID`, and its auction metrics.
- Raw price fields are copper. Use the shared money formatter for every price display; omit zero gold and silver denominations, but always show copper (for example, `65c`, `1s 0c`, `1g 23s 45c`).
- Search starts at two characters and returns all matching item names across scans. Keep suggestions keyboard accessible.
- The chart's default Y metric is `lowestBuyout`. Keep its selectable metrics and axis labels in sync with the series, scale, point labels, and tooltips; emphasize the selected Y metric in the point hover/focus tooltip.
- Plot X positions using elapsed time between timestamps, not evenly spaced observation indices. Avoid overlapping date labels without changing point positions.
- The selected-item chart includes current trade estimates and a Wowhead link. Set that link from the selected item's numeric ID, and open it in a new tab with `rel="noopener noreferrer"`.
- Keep the sticky-header section navigation anchors in sync with the chart, trading analysis, watchlist, and backtest sections. Preserve scroll offsets below the sticky header and honor reduced-motion preferences.
- The trading analysis derives a conservative reference price from recent `medianPrice` observations, applies the configured fee and ROI/profit thresholds, and treats `availableQuantity` only as an inventory proxy—not as sales volume.
- Candidate and backtest item links select the item in the chart; candidate/backtest links should smoothly scroll to the chart.
- The watchlist is stored in browser `localStorage`. Handle invalid saved data and storage failures visibly; do not imply the watchlist syncs across browsers.
- The backtest must calculate each historical buy signal only from scans preceding that entry. Future scans may be used only to simulate exits; exclude and report signals without a complete configured holding horizon. Backtest prices and fills are estimates from snapshots, not confirmed transactions.
- Keep scan and data-load errors visible; do not silently hide invalid or conflicting data.

## Validation

- Check JavaScript syntax with `node --check .\app\app.js`.
- For UI or data-flow changes, serve this directory over HTTP and verify search, metric selection, the time-scaled chart, point tooltips, and relevant trading-analysis, watchlist, or backtest behavior in a browser.
