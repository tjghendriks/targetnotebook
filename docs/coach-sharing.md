# Sharing cards with a coach: parked plan

**Status: paused (25 November 2026).** Nothing here is in the released app.
The work so far is on the `coach-upload` branch. Pick up from "Where it stands".

## The goal

Pupils' apps send their scanned card data to the coach. The coach reviews
every pupil on a private dashboard, to support team selection. Selection
should look beyond averages: reliability, group shape, consistency between
diagrams, and performance under pressure.

Ground rules agreed so far:
- One way only: pupils send, nothing syncs back. No pupil accounts.
- Card data only: no photos, training notes or My Setup.
- Pupils who never open a coach's setup link are unaffected; their data
  stays on their device.
- A **Send to coach** button, plus optional automatic sending on save.

## Where it stands

### Built (on `coach-upload`, uncommitted unless noted)
- **App (`js/coach.js`, Settings, Dashboard):**
  - setup page opened from the coach's link (`#/coach-setup?server=…&code=…`);
  - "Your coach" section in Settings: Send now, automatic sending switch,
    Stop sending;
  - Dashboard bar: "N cards not yet sent to your coach" with **Send to coach**;
  - tracks what was sent by a fingerprint of each card, so only new or
    changed cards go, deletions are reported, and re-joining sends
    everything again;
  - the coach link (with its device key) is kept out of backups.
- **Server (`server/`):** a Cloudflare Worker with a D1 database:
  - endpoints to register a device and to receive cards;
  - each device has its own random key, and only a SHA-256 hash of it is
    stored;
  - squad code held as a secret;
  - size limits on what is accepted, and CORS limited to the app's address;
  - coach dashboard at `/coach`: pupils table (average, spread, floor, best,
    group size, spread across and up), each pupil's cards with the card
    drawing, the setup link with a QR code, and device relabel and remove.
    It imports the app's own `model.js` and `render.js`, so scores always
    agree with the app.
- **Testing:** `dev/mock-coach.py` is a local stand-in for the server
  (squad code `squad`). The whole flow was tested against it in the browser.

### Live on Cloudflare (account of tom@tomhendriks.com)
- Worker `targetnotebook-coach`, at
  `https://targetnotebook-coach.tom-175.workers.dev`.
- D1 database `targetnotebook-coach` (id in `server/wrangler.toml`), with
  tables created.
- Secret `JOIN_CODE` set.
- The dashboard is **locked to everyone**: it expects Cloudflare Access,
  which was never set up. Pupil endpoints work but nobody has the link.
- Either delete these (Workers & Pages, D1) or keep them for Option 5 below.

### Not decided
- How the coach signs in: Option 5 or Option 3 below (Zero Trust Access
  was judged overkill).
- Tagging each card as practice, postal or match, and with the shooter's
  name, which the "pressure" metrics need.
- The selection metrics beyond the first table (list below).

## Option 5: keep Cloudflare, add our own coach password

Replaces Cloudflare Access with a sign-in inside the Worker. Most of it is
already built; about an hour's work remains.

- **Your sign-in:** `/coach` shows a password page.
  - You set the password yourself with
    `npx wrangler secret put COACH_PASSWORD`, and it never goes into the repo.
  - A correct password sets a signed sign-in cookie, which the page's own
    scripts can't read, is only sent over HTTPS, isn't sent when another
    site links to the dashboard, and lasts 30 days. A separate random
    `SESSION_SECRET` signs it, and changing the password signs everyone out.
  - A Sign out button.
- **Guessing:** 10 failures from one connection in 15 minutes blocks it for
  15 minutes (a new D1 table logs attempts). Password checks take the same
  time whether nearly right or completely wrong.
- **Your actions:** relabelling or removing a device needs a valid sign-in
  and must come from the dashboard itself.
- **Remove:** the Access check (`ACCESS_TEAM`, `ACCESS_AUD`).
- **Trade-offs:** one shared password with no second factor. That's
  proportionate for scores and shot positions, and a list of coach
  accounts can be added later. Code stays plain and portable.

## Option 3: Firebase (Google)

No server code of our own: pupils' apps write to Firestore, and permission
rules decide who can do what. About half a day's work.

- **Pupils:**
  - signed in to Firebase silently and anonymously, so each device gets its
    own identity (replacing the device key);
  - join with the squad code from the setup link, which the rules check
    against a copy no one can read;
  - write only to their own folder (`squads/{squad}/members/{uid}/cards/{id}`),
    with limits on size and shape;
  - can't read anything back;
  - the Firebase SDK is loaded only once a pupil has joined.
- **Coach:**
  - dashboard becomes a page on GitHub Pages (e.g. `coach.html`), so it uses
    the app's code directly;
  - Google sign-in (school account, with its two-step verification);
  - rules let in only emails on the squad's coaches list, so adding a coach
    is adding an email.
- **Your setup, about 10 minutes in the Firebase website:**
  1. Create a project on the free Spark plan (no card needed).
  2. Create a Firestore database in `europe-west2`.
  3. Turn on Anonymous and Google sign-in.
  4. Add `tjghendriks.github.io` as an allowed domain.
  5. Register a web app and hand over its (public) configuration block.
- **My part:** write and deploy the rules (Firebase command-line tool, with
  you signing in); switch `js/coach.js` to Firebase; move the dashboard;
  remove the Cloudflare Worker and database.
- **Limits:** 50,000 reads and 20,000 writes a day, 1 GB stored, which is
  ample. Doesn't pause during holidays.
- **Trade-offs:** proper accounts and extra coaches for free, but the
  permission rules are the whole security model and need careful testing,
  and the app is tied to Firebase's tools.

**Choosing:** one coach and the quickest route, Option 5. Several staff, or
school Google sign-in, Option 3.

## Selection metrics to build on the dashboard

From the design discussion. Show the number of cards next to every figure,
and grey out anything based on fewer than about 6.

- **Reliability:**
  - average with the spread of card totals;
  - floor: the 20th percentile, and the average of the worst fifth of cards;
  - share of cards at or above a target score;
  - form: the trend, and recent cards weighted more heavily.
- **Group quality (mm):**
  - mean radius and group size;
  - side-to-side and up-down spread separately, and how drawn out the group is;
  - how much the group centre wanders from card to card.
- **Moving between diagrams:**
  - side-to-side and up-down change between consecutive shots in firing order;
  - top row against bottom row, and left against right;
  - points lost at each position;
  - first-shot effect and late fade.
- **Pressure** (needs each card tagged as practice, postal or match):
  - average and spread in matches against practice;
  - postal against shoulder-to-shoulder matches;
  - first card against last on a match day.
- **Skirmisher:** attempts per card (speed) and hit rate (accuracy).
- **Views:** a ranked table by reliability rather than average; a chart of
  average against spread; a page for each pupil; a CSV export for
  selection meetings.

## Picking it up again

1. Switch to the branch: `git checkout coach-upload`. Rebase it onto `main`,
   since the app will have moved on.
2. Choose Option 5 or 3, and decide on the shooter and practice, postal or
   match fields.
3. Check the live Cloudflare items above still exist, or recreate them from
   `server/README.md`.
4. `wrangler` needs Node (installed with Homebrew) and a fresh
   `npx wrangler login` from `server/`.
