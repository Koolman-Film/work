# Koolman OIDC Smoke Test

A throwaway static page that exercises the full **LINE LIFF → `signInWithIdToken('custom:line')` → Supabase session** chain. Use once during W0 to confirm the auth path works against real credentials, then delete or archive.

**See also:**
- [`docs/v2/oidc-verification.md`](../../docs/v2/oidc-verification.md) — protocol-level verification + pass criteria
- [`docs/v2/credentials.local.md`](../../docs/v2/credentials.local.md) — credential reference (gitignored)

---

## What's pre-filled

The public-by-design values are already hardcoded in [`public/test-liff.html`](./public/test-liff.html):

| Constant | Value |
|---|---|
| `LIFF_ID` | `2010206636-7ktXQqFN` |
| `SB_URL` | `https://ficzlgdigcfwpkfbidjz.supabase.co` |
| `SB_ANON` | `sb_publishable_deNRKcZDo__jpadkJELFRw__xaxSM0J` |

The server-side secrets (`LINE_CHANNEL_SECRET`, `SUPABASE_SECRET_KEY`) are configured in the Supabase dashboard, not in this scaffold.

---

## Run procedure (~10 min)

### 1. Configure Supabase (one-time)

Dashboard → [Authentication → Providers](https://supabase.com/dashboard/project/ficzlgdigcfwpkfbidjz/auth/providers) → **Add provider** → **Custom OIDC**:

```yaml
identifier:        custom:line
issuer:            https://access.line.me
client_id:         2010206636
client_secret:     36c7074b9146d42e7bc3b8382ea8be49
scopes:            openid profile
email_optional:    true
skip_nonce_check:  true
```

Save.

### 2. Configure LINE Login channel (one-time)

[LINE Developer Console](https://developers.line.biz/console/) → "Koolman Work" channel → **LINE Login** tab → **Callback URL** → add:

```
https://ficzlgdigcfwpkfbidjz.supabase.co/auth/v1/callback
```

(Not strictly used by `signInWithIdToken`, but Supabase validates the provider config against it.)

### 3. Deploy this scaffold

From this directory:

```bash
cd tools/oidc-smoke
npx vercel --yes        # first run: links/creates the project; ~30s
# copy the deployment URL, e.g. https://koolman-oidc-smoke-abc.vercel.app
```

The page lives at `<deploy-url>/test-liff.html`.

### 4. Wire LIFF Endpoint URL

[LINE Developer Console](https://developers.line.biz/console/) → Koolman Work channel → **LIFF** tab → edit the LIFF app → **Endpoint URL** = your deploy URL + `/test-liff.html`. Save.

### 5. Run from your phone

On a phone with LINE installed, open:

```
https://liff.line.me/2010206636-7ktXQqFN
```

LINE will ask for consent on first run. Read the on-screen log.

---

## Pass criteria

You should see (with timestamps):

```
✅ liff.init OK
✅ liff.getProfile OK
✅ liff.getIDToken OK — length <large number>
✅ Supabase session created
✅ getUser() round-trip — same id = true
✅ LINE userId matches OIDC sub — full chain verified
```

If all six green ✅ → **Stage 2 PASS**. Proceed to W1.

---

## Common failures (paste into chat for help if stuck)

| Symptom | Likely cause | Fix |
|---|---|---|
| `liff.getIDToken() returned null` | LIFF scope missing `openid` | LINE console → LIFF app → scopes → add `openid` |
| `nonce mismatch` | Supabase `skip_nonce_check = false` | Edit Custom OIDC Provider, set `skip_nonce_check: true` |
| `email is required` | Supabase `email_optional = false` | Edit Custom OIDC Provider, set `email_optional: true` |
| `provider 'custom:line' not enabled` | Provider not saved or wrong identifier | Re-add provider; identifier must be exactly `custom:line` |
| `invalid_grant` / signature verify failed | Wrong `client_id` (channel ID) | Confirm channel ID `2010206636` matches LINE console exactly |
| LIFF page won't open in LINE | Endpoint URL mismatch | Endpoint URL must equal the exact deployed URL including `/test-liff.html` |
| `aud` mismatch in token decode | Channel ID typo | Re-check Supabase OIDC config |
| Network errors / CSP blocks | Browser cache | Hard reload, or hit "Reset session & re-run" button |

---

## After Stage 2 passes

1. Mark [`docs/v2/oidc-verification.md §6`](../../docs/v2/oidc-verification.md) status as PASS.
2. Cross off W0 verification task in [`docs/v2/build-plan.md`](../../docs/v2/build-plan.md).
3. **Rotate the secrets that were shared in chat** (`LINE_CHANNEL_SECRET`, `SUPABASE_SECRET_KEY`, `SUPABASE_DB_PASSWORD`) before any production data lands.
4. Either delete this `tools/oidc-smoke/` directory or keep it as a regression test (the page itself is harmless).
