# GoT: Conquest - Military 3 | Dragon Combat Research Planner

A static calculator for Military III and Dragon Combat research. Its six calculator-specific JSON files contain the required research levels, costs, prerequisites, and stat gains. Research time is excluded.

## Run locally

Double-click **Start App.cmd**, then open `http://localhost:8765`. Keep the server window running while using the app. Python 3 is required.

Alternatively:

```text
python -m http.server 8765 --bind 0.0.0.0 --directory web
```

To test on a phone, connect it to the same Wi-Fi network and open `http://COMPUTER-WIFI-IP:8765` using the computer's Wi-Fi IPv4 address from `ipconfig`. Keep the computer awake and the server running. If Windows requests permission for Python, allow it on your private home network. A guest Wi-Fi network may block connections between devices. The phone has its own saved progress; use Backup to transfer a profile.

## Calculator

- Add multiple research goals from either tree using the searchable selector.
- The selector opens with focus on Close so the search field does not automatically summon a mobile keyboard. Adding an item keeps the selector open and changes its button to Unselect; filters and list position are retained. Unselect removes the goal while retaining recorded progress. Research still required by another goal remains included in its requirements and costs. Close or Escape returns to the calculator.
- Enter current and desired levels. Costs include ranks above the current level through the desired level.
- Research level fields visibly cap entered values at that research's maximum (currently 15). The Maester field caps at 40. Oversized typed or pasted values are corrected immediately and saved within the allowed range.
- Expand each research's requirements to enter partial progress or check Achieved. Unchecking restores the previous recorded level; without a prior checkbox action, it sets the level to zero.
- Current levels are shared across goals. Shared prerequisites count once, at the highest level needed. Any completed rank proves the research was unlocked, so its earlier unlock prerequisites are not charged again.
- Removing a goal keeps its completed level saved.
- Reset opens a confirmation dialog. Confirming clears selected research and all boosts, while retaining recorded research levels and the Maester level. Cancel leaves the calculation unchanged.
- The combined Maester requirement is the maximum building level for unfinished research ranks. Each selected research also shows the building level for its desired rank. Building upgrade costs are not included.
- Original and reduced resource/material costs appear together. Expand individual or combined breakdowns to trace costs. Combined stat gains include unfinished prerequisites, counted once.
- Cost adjustments are above the totals on mobile, and beside the calculation on desktop. Material adjustments expand separately. All boost inputs are available regardless of the selected tree.
- Help explains the workflow. Stat gains retains the full level 0–15 property data and troop filters.

Reduced cost = original cost × (1 − reduction / 100) ÷ (1 + total efficiency / 100).

For Food, Wood, Stone, and Iron, total efficiency adds Research Resource Efficiency to the resource-specific efficiency. Each resource/material has its own reduction. Displayed values are rounded; calculations retain full precision.

## Saved progress and backups

Progress saves automatically in the browser's local storage, separately for each browser profile and site origin. There is no account or automatic synchronization between devices. Use **Backup → Export progress** before clearing site data or moving to another browser, device, or hosting URL. Import replaces the current profile.

The calculator retains the original storage key and migrates the previous interface's saved goals, levels, Maester level, boosts, and undo history. Version 1 backups from Conquest Research Atlas and the renamed planner remain supported.

## Development

- `web/model.mjs`: pure prerequisite, cost, and stat calculations.
- `web/progress.mjs`: saved-data normalization, migration, and reversible completion changes.
- `web/app.mjs`: rendering, input handling, navigation, and backups.
- `web/styles.css`: responsive layout and presentation.
- `web/data/research.json`: generated browser data.
- `source-data/`: six cleaned calculator-specific JSON files, with three per tree:
  - `*-research.json`: research names, stable IDs, layout, maximum levels, and prerequisites.
  - `*-stats.json`: stat names, units, troop scopes, and level 1–15 gains.
  - `*-costs.json`: resource/material costs and Maester requirements for levels 1–15.
- `test-fixtures/`: sample saved profiles used by regression tests.
- `.github/workflows/pages.yml`: validation and automatic GitHub Pages deployment.

The app uses standard HTML controls, native details/summary disclosures and modal dialogs, and ES modules. Native control behavior follows [MDN details documentation](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details) and [dialog documentation](https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/showModal). Storage behavior is described in [MDN localStorage documentation](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage).

Inputs and imported backups are normalized at the boundary. Numeric ranks are integers and capped at their valid ranges. Source names are escaped before rendering. The focused input node is retained during live recalculation so typing decimal boosts and multi-digit levels works without losing the keyboard or focus.

Refresh data after changing the cleaned JSONs:

```text
python build_data.py
node test_model.mjs
```

The checks cover all 83 researches, both trees, cost formulas, shared and partial prerequisites, completed branch pruning, reversible confirmations after a reload, and saved-profile migration and validation. Browser checks should use a separate local port to keep the user's current profile intact.

## Hosting

Repository: [lipegotc/gotc-newresearch-planner](https://github.com/lipegotc/gotc-newresearch-planner).

Site address: [Research planner](https://lipegotc.github.io/gotc-newresearch-planner/).

In the repository's **Settings → Pages**, set **Build and deployment → Source** to **GitHub Actions**. Run **Test and deploy calculator** from the Actions tab if needed for the first deployment.

Every push to `main` regenerates the source data, verifies the generated file matches the committed version, runs the calculator tests, and publishes only `web/`. Pull requests run validation without publishing. A failed test prevents deployment.

Assets use relative URLs, so repository sites work as well as root sites. No application server, API key, database, or dependency installation is required. Calculations and progress storage run independently in each visitor's browser.

### Updates

Test interface or calculation changes locally, then commit and push:

```text
node test_model.mjs
git add web
git commit -m "Update calculator"
git push
```

For game-data changes, edit the applicable cleaned files in `source-data/` using their existing schema, regenerate, test, and commit both source and generated data. Keep research IDs stable so saved user progress continues to match. Raw game tables are not inputs to the published builder:

```text
python build_data.py
node test_model.mjs
git add source-data web/data/research.json
git commit -m "Update research data"
git push
```

Stage any other changed project files explicitly as needed. Check the Actions tab for deployment results. Refresh the live page after a successful deployment to load the update.

Keep the storage key and saved-profile migrations compatible when changing the app. Normal deployments preserve saved browser progress. Localhost and GitHub Pages use separate storage, so export a local profile through Backup and import it on the published site.

The original spreadsheet and JSON references are kept locally in `local-reference/` and excluded from Git. Generated preview images and unrelated executable inspection files are not part of the application.
