# Target Notebook coach server

Pupils' apps send their card data here, and you review it on a private
dashboard. It runs on Cloudflare: a Worker (the program), a D1 database (the
cards), and Cloudflare Access (your sign-in to the dashboard). The free plan
covers a school squad.

Nothing changes for anyone who doesn't open your setup link: their cards stay
on their device. Pupils send card data only, never photos, training notes or
My Setup.

## Setting it up (all in the Cloudflare dashboard)

### 1. The database
1. **Storage & Databases → D1 → Create database**, named `targetnotebook-coach`.
2. Copy its **Database ID** into `database_id` in `wrangler.toml` and commit it.
   (The ID isn't secret: it only works with your account.)
3. Open the database's **Console**, paste in all of `schema.sql`, and run it.

### 2. The Worker
1. **Workers & Pages → Create → Import a repository**, and pick
   `tjghendriks/targetnotebook`.
2. Set the **project name** to `targetnotebook-coach` (it must match `name` in
   `wrangler.toml`) and the **root directory** to `server`. Leave the build
   command empty and the deploy command as `npx wrangler deploy`.
3. It deploys on every push to `main`. Note its address, which looks like
   `https://targetnotebook-coach.<your-subdomain>.workers.dev`.

The repo is already connected to a Worker called `targetnotebook` that doesn't
exist, which is why PRs show a failing "Workers Builds" check. Once this
Worker is set up, delete that old connection under **Workers & Pages**.

### 3. The squad code
In the Worker's **Settings → Variables and Secrets**, add a **secret** named
`JOIN_CODE`, set to a long random phrase, e.g. `kestrel-orbit-4417-meadow`.
It goes into the pupils' setup link. Change it to stop an old link working;
pupils who already joined carry on.

### 4. Your sign-in (Cloudflare Access)
1. **Zero Trust → Access → Applications → Add an application → Self-hosted**.
2. Add the Worker's address twice, with paths `coach` and `api/coach`.
3. Add a policy: **Allow**, **Emails**, your email address.
4. Save, then copy the application's **Audience (AUD) tag**.
5. In `wrangler.toml`, set `ACCESS_TEAM` to your team name (the part before
   `.cloudflareaccess.com`, shown under Zero Trust → Settings) and `ACCESS_AUD`
   to the tag, then commit.

The Worker checks Access's signed token itself as well, so the dashboard stays
closed even if Access were switched off by mistake.

### 5. Try it
Open `https://<worker address>/coach`. Sign in with the emailed code, and
you'll see the dashboard with the pupils' setup link and its QR code.

## Testing without Cloudflare

`python3 dev/mock-coach.py` runs a stand-in on http://localhost:8787 with
the same endpoints (squad code `squad`), for use with `dev/serve.py`. It has
no sign-in at all, so never run it anywhere others can reach.
