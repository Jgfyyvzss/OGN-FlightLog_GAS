# OGN-FlightLog_GAS

Using Google Apps Script (GAS) in a Sheet, the OGN-FlightLog pulls glider & tow plane launch and landing data from Glidernet.org.
The scripts provide a WebApp for use on the field to add pilot, passenger, tug pilot, etc details to each flight, using dropdowns or free text entry.
After flying the treasurer can simply download/copy a full set of invoices (TSV, CSV, QIF as applicable to their accounting needs) and import them to the their exisiting invoicing system. Another WebApp provides easy access to to the Export page.
The system is extensively configured from within the Sheet - select which export format you require, club name, airfield IATA/OGN code, timezone etc. Pilot, instructor and Tuggie names for dropdowns are held in the Sheet too.

This repository provides the source files for the scripts.
Scripts can either be manually pasted into your own Sheet and deployed, or a club can join the project whereupon all changes made in this source will be periodically manually pushed to their GAS. You will need to make contact to do that.

Initially the accounting packages Manager.io and Reckon have export scripts. Others can be added.
A planned addition is using API's to send the invoices to the accounting packages directly, one-click.
Another is to pull the member, instructor and tuggie list from a main club membership list.

<img width="710" height="771" alt="flighlog snip" src="https://github.com/user-attachments/assets/b1aee448-ba22-495d-b747-042103a042d1" />
Main airfield data entry screen.
<br>
<br>
<img width="429" height="351" alt="ASMB Flight Export" src="https://github.com/user-attachments/assets/ddfa1c08-5e71-4b89-a849-aff2161a85af" />
Invoice Export screen.

# ASMB Flight Log — Apps Script source

Canonical source for the flight log / accounting-export system, shared
between multiple clubs. This repo is the single source of truth —
**never edit code directly in the Apps Script browser editor**. Edit
here, push, then deploy via GitHub Actions.
**WARNING: Manual edits/new files in a live Apps Script editor will be silently destroyed on the next deploy!**
`clasp push` replaces the **entire** contents of the target project with
whatever's in this repo — there's no partial update. Any file added, or
any edit made, directly in a club's Apps Script editor will be **silently
deleted** on the next deploy. No warning, no diff, no confirmation.

If you want to try something quickly: use the sandbox project, not a
live club project. Once it works, commit it here and deploy properly.

## Structure

```
/src/            All .gs and .html files, plus appsscript.json.
                 This is exactly what gets pushed to both Apps Script
                 projects — nothing club-specific lives in here.
                 Per-club differences belong in each club's own
                 Config/Costs/People sheet, not in this code.
/.github/workflows/deploy.yml
                 Manual-trigger deploy pipeline (see below).
```

## Editing (day to day)

Open this repo at `github.dev` (press `.` on the repo page, or replace
`github.com` with `github.dev` in the URL) for a full browser-based
editor — no local install required, works fine from a low-powered
machine. Edit, commit, push like any repo.

## Deploying

1. Go to the **Actions** tab.
2. Select **Deploy to Apps Script**.
3. Click **Run workflow**, choose `both` / `asmb-only` / `clubb-only`.
4. Done — no local clasp install needed anywhere for this.

This is deliberately a manual button, not automatic on every push, so
a half-finished edit never accidentally goes live for pilots mid-session.

## One-time setup (prerequisites — do these before the workflow will work)

These are account/access steps, not code — do them once:

1. **Dedicated Google account** for deployments (not a personal
   account) — added as **editor** on both clubs' Apps Script projects
   and both Sheets. This is the identity clasp authenticates as.

2. **`clasp login`** — from any machine (or a throwaway Codespace),
   log in as that dedicated account:
   ```
   npm install -g @google/clasp
   clasp login
   ```
   This creates `~/.clasprc.json`. Copy its full contents.

3. **GitHub Secret** — repo Settings → Secrets and variables → Actions
   → **Secrets** tab → New repository secret:
   - Name: `CLASP_CREDENTIALS`
   - Value: the full contents of `~/.clasprc.json` from step 2

4. **GitHub Variables** — same location, **Variables** tab → New
   repository variable (these aren't secret, just IDs):
   - `ASMB_SCRIPT_ID` — from ASMB's Apps Script project:
     Project Settings (gear icon) → Script ID
   - `CLUBB_SCRIPT_ID` — same, from Club B's project once it exists

5. **First real test** — before trusting this for real edits, make a
   trivial no-op change (e.g. a comment), push, run the workflow with
   `asmb-only`, and confirm it shows up in the Apps Script editor.

## Explicitly out of scope here

Direct Manager.io API integration and any move off Google
Sheets/Apps Script are separate, later decisions — not part of this
repo's job. This repo's only job is: one codebase, deployable to both
clubs, with no drift.
