# FlightLog — Pilot Entry Webapp: Quick Reference

## Accessing it
Open the club's FlightLog web link (bookmark it). Flights from today auto-load; if none yet today, the last 3 days show.

## Main screen
- **Flight list** — cards for each flight tracked by OGN today. Status badge: `Needs Pilot` / `Flying` (still airborne) / `Logged`.
- Tap a card to select it — it highlights and the form below fills in.

## Logging your flight (the normal case)
1. Tap your flight card.
2. **Invoiced Pilot / Student / AEF** — required. Pick from dropdown, or tap **Visitor** to type a name not on the list.
3. **Instructor / Priv Pax / Mutual** — optional, same dropdown/Visitor pattern.
4. **Winch Driver** — only if it's a winch launch and not already recorded.
5. **Special Billing** — leave blank unless one applies (see below).
6. **Remarks** — optional, 80 chars (e.g. cable break reason, No Charge reason).
7. Tap **Submit Flight Log**.

### Special Billing options
| Value | Meaning |
|---|---|
| *(blank)* | Normal — pilot pays full price |
| **AEF** | Air Experience Flight — launch/tow line kept for records but priced at $0 |
| **Shared** | Split 50/50 between Pilot and Pax (only if club has split billing turned on) |
| **No Charge** | Manual override — flight logged and billed as normal but priced at $0 (e.g. cable break, waived training flight) |
| **Self Launch** | Suppresses the launch/tow billing line; flight-time billing still applies |

## If your flight isn't showing
- Tap **🔄 Refresh Flights** to re-pull from OGN.
- Still missing? It may not have tracked (FLARM issue) — use **➕ Add Glider Flight** to enter it manually.
- A tug/tow flight with no glider attached shows as an **orphan tug** — you can attach it to your glider flight from the *Select Tug Flight* dropdown inside **Add Glider Flight**, or merge it later via **Edit Selected Flight**.

## Adding flights manually
- **➕ Add Glider Flight** — date, takeoff time, rego, CN, type, landing time, pilot/pax, special billing, and optionally attach an existing orphan tug flight.
- **🛩️ Add Tug Flight** — date, takeoff time, tug rego, max alt, landing/flight time, tug pilot.

## Editing
- **Edit Selected Flight** (enabled once a flight is selected) — fix date/time/rego/type, pilot/pax, special billing, remarks, and tug pilot **or** winch driver (whichever applies to that flight).
- **✈️ Edit Tugs** — bulk-assign/fix tug pilot names across all tug flights logged today.

## Visitor toggle
Any field with a **Visitor** button lets you type a name that isn't in the club's People list (e.g. a guest pilot, guest instructor, or visiting tug/winch operator). Tap again to switch back to the dropdown.

## After submitting
The flight is marked **Logged** and the form resets. If refresh fails after a successful submit, your entry is still saved — just refresh manually.

## Notes
- A flight needs a **Pilot** entered before it can be exported/invoiced — flights left blank are skipped at export time.
- Times display as `HHhMM` (e.g. `11h38`).
- **Ignored pilot** — entering the club's designated placeholder name (default `Z_IGNORE`, configurable) as the Pilot permanently excludes that flight from invoice exports. Use this for test flights or ones that should never be billed, rather than leaving Pilot blank (which just gets flagged as skipped/needing attention).
