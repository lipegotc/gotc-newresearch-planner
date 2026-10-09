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
- Cost adjustments are above the totals on mobile, and beside the calculation on desktop. Material adjustments expand separately. Military 3 and Dragon Combat have separate boost tabs. Each set applies only to its own tree, including prerequisites. Military 3 excludes Dragon Lore, Dragon Secrets, and Dragon Tomes; Dragon Combat includes all materials. Existing saved common boosts are copied to both tabs on upgrade, then can be edited independently.
- Boosts accept either decimal separator, for example `24.22` or `24,22`, including `.5` or `,5`. Partial input and cursor position are retained while typing. Values save as numbers; leaving the field normalizes its display. Reductions remain capped at 100%.
- Help explains the workflow. Gains/Costs Reference has Military 3 and Dragon Combat submenus with level 1-15 stats, troop filters, and original costs for each individual research level and resource/material. Costs exclude boosts and prerequisites. Totals above the table cover the selected troop scope plus General research (including march sizes) to maximum level, with minimum prerequisites counted once. With no scope filter, totals cover the whole tree. Search filters the level table only. Reference totals ignore saved progress and boosts. Scroll the table horizontally to see all costs on smaller screens.

Reduced cost = original cost × (1 − reduction / 100) ÷ (1 + total efficiency / 100).

For Food, Wood, Stone, and Iron, total efficiency adds Research Resource Efficiency to the resource-specific efficiency. Research Resource Reduction adds to the specific reductions for Food, Wood, Stone, and Iron, capped at 100% combined. Materials use only their own reduction. Displayed values are rounded; calculations retain full precision.

## Optimizer

Choose Military 3 or Dragon Combat, a research group, and one or more of Attack, Defense, Health, and March Size. Infantry, Cavalry, and Ranged include General bonuses. Dragon Combat also has a Dragon Specific group with separate Dragon Defense and Dragon Attack vs. Dragon goals.

- Resources, current levels, Maester level, and both trees' boost profiles sync with Calculator.
- Set **RSS kept (%)** for each resource/material separately to leave that percentage unspent.
- Assign each selected goal a distinct **importance** from 1 to 100 (selected goals cannot share a weight), then choose **Plain gain** (default) or **Remaining progress**. Plain gain weights actual percentage bonus points and march troop counts directly; large march counts can dominate a mixed goal because the units differ. Remaining progress weights each gain as a fraction of that goal’s remaining research bonuses reachable at your Maester level, before resource limits. Neither mode guarantees a minimum stat gain. A weight of 2 gives twice the score contribution of 1 for the same compared gain.
- The optimizer maximizes weighted progress across selected research bonuses within every resource budget, including exact tier costs and shared prerequisites, and respecting the Maester level.
- Troop/stat labels use small game-inspired icons; combinations use paired icons. A yellow note explains when the march troop count exceeds the displayed gain for another selected priority, with no note for March Size-only plans.
- Results show gains, a collapsible Research Order in valid prerequisite order, discounted spending, and remaining resources. Conditional bonuses are summed for the selected group; this is not a battle damage simulator.
- **Optimal** means the best gain was proved within numerical tolerances. **Best found** means the search reached its limit; a better plan may exist.
- **Use plan in Calculator** asks for confirmation before replacing manual selections and desired levels. It does not spend resources or mark recommended levels completed.
- Input changes invalidate previous results. Settings persist and are included in backups; regenerate recommendations after reopening.

Optimization runs on your device using the bundled MIT-licensed HiGHS JavaScript/WebAssembly solver (version 1.15.3) in a background worker. No AI service or external solver API is used. Costs remain estimates because the game may use greater boost precision internally; keep a buffer and check in-game costs.

## Saved progress and backups

Progress saves automatically in the browser's local storage, separately for each browser profile and site origin. There is no account or automatic synchronization between devices. Use **Backup → Export progress** before clearing site data or moving to another browser, device, or hosting URL. Import replaces the current profile.

The calculator retains the original storage key and migrates the previous interface's saved goals, levels, Maester level, boosts, and undo history. Version 1 and 2 backups from Conquest Research Atlas and the renamed planner remain supported.
