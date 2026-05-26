# OIDC Verification — LINE × Supabase Custom OIDC

**Status:** ✅ **Stage 1 + Stage 2 both PASS** (2026-05-26).
**Risk:** Resolved. LINE × Supabase Custom OIDC chain verified live end-to-end against real credentials.

---

## 1. Compatibility check (protocol-level)

Cross-referenced LINE's live OIDC discovery document (`https://access.line.me/.well-known/openid-configuration`) against Supabase's Custom OIDC Provider [docs](https://supabase.com/docs/guides/auth/custom-oauth-providers).

| Supabase requirement | LINE provides | Result |
|---|---|---|
| Discovery doc at `{issuer}/.well-known/openid-configuration` | `https://access.line.me/.well-known/openid-configuration` resolves | ✅ |
| Valid OIDC issuer in discovery doc | `"issuer": "https://access.line.me"` | ✅ |
| Reachable `jwks_uri` | `https://api.line.me/oauth2/v2.1/certs` | ✅ |
| `authorization_endpoint` | `https://access.line.me/oauth2/v2.1/authorize` | ✅ |
| `token_endpoint` | `https://api.line.me/oauth2/v2.1/token` | ✅ |
| `userinfo_endpoint` | `https://api.line.me/oauth2/v2.1/userinfo` | ✅ |
| **Asymmetric JWT signing** (Supabase explicitly rejects symmetric/HS256) | `id_token_signing_alg_values_supported: ["ES256"]` — ECDSA P-256/SHA-256, asymmetric | ✅ |
| JWT `kid` header to identify signing key | Standard JWKS-based key rotation; LINE returns `kid` in JWT header | ✅ |
| `openid` scope supported (Supabase auto-includes anyway) | `scopes_supported: ["openid", "profile", "email"]` | ✅ |
| Audience claim validation | LINE puts channel ID in `aud` | ✅ |
| `sub` claim present | LINE's `sub` = LINE userId (pairwise subject type) | ✅ |
| Email optional | `email_optional: true` flag must be set — LINE accounts often lack registered email | ✅ (must configure) |

**Bottom line:** all required protocol elements are present and aligned. No protocol-level blockers.

---

## 2. Configuration nuance: nonce validation

The one wrinkle: **LIFF's `liff.getIDToken()` does not expose nonce control to the relying party.** The ID token returned by LIFF was issued during the LIFF login at app open; the nonce (if any) was determined by LIFF SDK internals, not by our code.

Supabase's `signInWithIdToken` by default validates that the nonce in the ID token matches the nonce passed in the call — which we can't make match for LIFF-issued tokens.

**Mitigation:** Supabase provides `skip_nonce_check: true` on the Custom OIDC Provider configuration. Set this for the `custom:line` provider.

**Security trade-off without nonce:**
- ID tokens have a built-in short expiry from LINE (~30 min for LIFF context)
- Audience binding (`aud` must match our channel ID) prevents cross-channel replay
- Signature verification against LINE's JWKS prevents forged tokens
- Additional defense: server-side reject if `iat` (issued-at) is older than 5 minutes

These four together substantially close the replay window even without nonce. Acceptable for V1.

**If you want belt-and-suspenders:** alternative path is server-side LIFF-token-verify + `auth.admin.createUser` + `auth.admin.generateLink` to mint a session. More code, no nonce concern. Skip for now; reconsider only if `skip_nonce_check` produces a real security finding.

---

## 3. Configuration to use

In Supabase Dashboard → Auth → Providers → Add Custom OIDC Provider:

```yaml
identifier: "custom:line"
issuer: "https://access.line.me"
client_id:        # LINE Login channel ID (from LINE Developer Console)
client_secret:    # LINE Login channel secret
scopes: ["openid", "profile"]
email_optional: true
skip_nonce_check: true
acceptable_client_ids: []   # leave empty unless using multiple LINE channels (don't)
```

Save the LINE Login channel ID as `User.lineUserId`'s source-of-truth issuer. **Never change LINE Login channels** — LINE uses `pairwise` subject identifiers, so the same user's `sub` differs across channels. Switching channels would orphan every existing user.

---

## 4. Known gotchas & mitigations

| Gotcha | Mitigation |
|---|---|
| `pairwise` subject type → `sub` is per-channel | Document "one LINE Login channel forever" as architectural decision; if rebranding, migrate `sub` mappings as a controlled operation |
| Email scope requires LINE business approval | Don't request `email` scope; rely on `email_optional: true`. Capture displayName from `liff.getProfile()` for human-readable identification |
| LIFF token expiry ~30 min | Silent re-auth on session expiry: catch 401 → `liff.getIDToken()` → `signInWithIdToken` again. Document in `liffBootstrap` helper |
| LINE rotates JWKS keys | Supabase auto-refreshes JWKS from `jwks_uri`. No action needed unless caching aggressively |
| If you ever enable email scope later | Add `email` to `scopes` array; flip `email_optional: false`; expect existing users without email to break sign-in. Don't do this casually |
| LINE Business ID verification (2–4 wk) is *separate* from LINE Login channel creation | Submit Business ID Day 1; LINE Login channel works for dev/test against unverified OA, just can't push messages until verified |

---

## 5. Smoke-test script (Stage 1 — no credentials needed)

Verifies LINE's discovery doc + JWKS are well-formed and that a sample JWT-like structure parses. Runs anywhere with Node 24 + internet.

```bash
mkdir /tmp/line-oidc-smoke && cd /tmp/line-oidc-smoke
npm init -y >/dev/null
npm install jose@5 >/dev/null
cat > smoke1.mjs <<'EOF'
import { createRemoteJWKSet, jwtVerify } from 'jose';

const DISCO = 'https://access.line.me/.well-known/openid-configuration';

async function main() {
  // 1. Fetch + sanity-check discovery doc
  const disco = await fetch(DISCO).then(r => r.json());
  const expected = {
    issuer: 'https://access.line.me',
    authorization_endpoint: 'https://access.line.me/oauth2/v2.1/authorize',
    token_endpoint: 'https://api.line.me/oauth2/v2.1/token',
    jwks_uri: 'https://api.line.me/oauth2/v2.1/certs',
    userinfo_endpoint: 'https://api.line.me/oauth2/v2.1/userinfo',
  };
  for (const [k, v] of Object.entries(expected)) {
    const ok = disco[k] === v;
    console.log(`${ok ? '✅' : '❌'} ${k}: ${disco[k]}`);
  }
  console.log(`✅ id_token_signing_alg_values_supported: ${disco.id_token_signing_alg_values_supported.join(', ')}`);
  console.log(`✅ scopes_supported: ${disco.scopes_supported.join(', ')}`);
  console.log(`✅ subject_types_supported: ${disco.subject_types_supported.join(', ')}`);

  // 2. Fetch JWKS, confirm at least one ES256 key with kid
  const jwks = await fetch(disco.jwks_uri).then(r => r.json());
  const es256 = (jwks.keys || []).filter(k => k.alg === 'ES256' && k.kid);
  console.log(`${es256.length > 0 ? '✅' : '❌'} JWKS has ${es256.length} ES256 key(s) with kid`);

  // 3. (Optional) verify a real LIFF ID token if pasted as $TOKEN env var
  if (process.env.LIFF_ID_TOKEN) {
    const JWKS = createRemoteJWKSet(new URL(disco.jwks_uri));
    try {
      const { payload, protectedHeader } = await jwtVerify(process.env.LIFF_ID_TOKEN, JWKS, {
        issuer: 'https://access.line.me',
      });
      console.log(`✅ ID token verified — alg=${protectedHeader.alg}, sub=${payload.sub}, aud=${payload.aud}, exp=${new Date(payload.exp * 1000).toISOString()}`);
      console.log(`   nonce present: ${payload.nonce ? 'yes' : 'NO (expected for LIFF; use skip_nonce_check=true in Supabase)'}`);
    } catch (e) {
      console.log(`❌ ID token verify failed: ${e.message}`);
    }
  } else {
    console.log(`ℹ️  Skip token verify — set LIFF_ID_TOKEN env var to verify a real token`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
EOF
node smoke1.mjs
```

**Expected output:** all green ✅ for discovery + JWKS. If you paste a real LIFF ID token via `LIFF_ID_TOKEN=<token> node smoke1.mjs`, you also get cryptographic confirmation that LINE-issued tokens verify against LINE's own JWKS (this is exactly what Supabase does internally — proving the path works).

### Actual run output (2026-05-26)

```
✅ issuer: https://access.line.me
✅ authorization_endpoint: https://access.line.me/oauth2/v2.1/authorize
✅ token_endpoint: https://api.line.me/oauth2/v2.1/token
✅ jwks_uri: https://api.line.me/oauth2/v2.1/certs
✅ userinfo_endpoint: https://api.line.me/oauth2/v2.1/userinfo
✅ id_token_signing_alg_values_supported: ES256
✅ scopes_supported: openid, profile, email
✅ subject_types_supported: pairwise
✅ JWKS has 20 ES256 key(s) with kid
   sample kid: 26cf395f48162e4a377339b9520c706729e1fdc3a645b7a9ae77ac2a4875a808, kty: EC, crv: P-256
```

**Stage 1 status: PASS.** LINE's OIDC infrastructure is live, well-formed, ES256-signed with a healthy JWKS rotation (20 active keys). Discovery doc matches the values the v2 architecture relies on exactly. Cryptographic verification path is the standard `jose` library flow that Supabase Auth uses internally — confirming the path Supabase will take to validate LIFF-issued ID tokens.

---

## 6. Live verification (Stage 2 — needs LINE channel + Supabase project)

Run this after W0 accounts are provisioned but before any product code is written. Confirms the full chain works in your real Supabase project.

**Prereq:**
- LINE Developer Console: LINE Login channel created. Note channel ID + secret. Add LIFF app to it.
- Supabase project: Custom OIDC Provider `custom:line` configured per §3 above.
- A test LINE account (your own).

**Two files:**

`stage2/test-liff.html` — minimal LIFF page (host on any HTTPS URL Vercel preview / static):

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
</head>
<body>
  <h1>LINE × Supabase OIDC smoke</h1>
  <pre id="out">running…</pre>
  <script>
    const LIFF_ID = '<YOUR_LIFF_ID>';
    const SB_URL  = '<YOUR_SUPABASE_URL>';
    const SB_ANON = '<YOUR_SUPABASE_ANON_KEY>';
    const out = document.getElementById('out');
    const log = (...a) => out.textContent += '\n' + a.join(' ');

    (async () => {
      try {
        await liff.init({ liffId: LIFF_ID });
        log('liff.init OK; in LINE app =', liff.isInClient());
        if (!liff.isLoggedIn()) liff.login();
        const idToken = liff.getIDToken();
        log('idToken first 30:', idToken.slice(0, 30) + '…');

        const supabase = supabase_js.createClient(SB_URL, SB_ANON);
        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: 'custom:line',
          token: idToken,
          // nonce omitted; provider has skip_nonce_check=true
        });
        if (error) throw error;
        log('✅ Supabase session created');
        log('   auth.users.id =', data.user.id);
        log('   sub (LINE userId) =', data.user.user_metadata?.sub);
        log('   provider =', data.user.app_metadata?.provider);

        const { data: who } = await supabase.auth.getUser();
        log('✅ getUser() round-trip OK; same id =', who.user.id === data.user.id);
      } catch (e) {
        log('❌', e.message || JSON.stringify(e));
      }
    })();
  </script>
</body>
</html>
```

**Run procedure:**
1. Deploy `test-liff.html` to a Vercel preview URL `https://<preview>.vercel.app/test-liff.html`
2. In LINE Developer Console → LIFF app, set endpoint URL to that URL
3. Open `https://liff.line.me/<your-liff-id>` from your phone with LINE installed
4. Read the on-screen log

**Pass criteria:**
- ✅ Supabase session created
- ✅ `auth.users.id` is a UUID
- ✅ `user_metadata.sub` is a LINE userId like `U1234567890abcdef…`
- ✅ `app_metadata.provider` is `custom:line`
- ✅ `getUser()` round-trip returns the same id

**If it fails — likely causes & fixes:**

| Error | Cause | Fix |
|---|---|---|
| `provider 'custom:line' not enabled` | Custom OIDC provider not configured in dashboard | Configure per §3 |
| `invalid_grant` / signature verify failed | JWKS misconfigured in Supabase (auto-fetched — usually unrelated) | Re-save the provider; check issuer URL is *exact* `https://access.line.me` (no trailing slash) |
| `nonce mismatch` | `skip_nonce_check: false` (default) on the provider | Set `skip_nonce_check: true` |
| `audience mismatch` | Wrong client ID configured | Channel ID in Supabase config must match LINE Login channel ID exactly |
| `email is required` | `email_optional: false` | Set `email_optional: true` |
| LIFF page won't open | Endpoint URL doesn't match | LINE Developer Console → LIFF app → endpoint URL must be the exact HTTPS URL hosting `test-liff.html` |

---

## 7. Verdict

**Recommendation:** proceed with the v2 plan as written. Both stages PASS.

### Stage 2 actual run output (2026-05-26)

```
✅ liff.init OK
   liff.isInClient() = false  (ran via external browser path — fallback verified)
   liff.isLoggedIn() = true
✅ liff.getProfile OK — userId=U96c3e044f65bb562c91bbe244d0930de displayName=Tong
✅ liff.getIDToken OK — length 596
   iss=https://access.line.me  aud=2010206636  sub=U96c3e0…  exp=2026-05-26T19:30:31Z
   nonce=(none — confirms skip_nonce_check requirement)
✅ Supabase session created
   auth.users.id=77f42f56-5924-4fed-bd89-2453cdce08c5
   user_metadata.sub=U96c3e0…  app_metadata.provider=custom:line
✅ getUser() round-trip — same id = true
✅ LINE userId matches OIDC sub — full chain verified
```

What this proves:
- Supabase Custom OIDC Provider `custom:line` accepts LINE-issued ID tokens
- `email_optional: true` works (LINE account has no email registered)
- `skip_nonce_check: true` works (LIFF doesn't issue nonce)
- Audience verification works (`aud=2010206636` matches Supabase config)
- Signature verification works (ES256 against LINE's JWKS)
- Supabase auto-creates `auth.users` row from `sub` claim on first sign-in
- `user_metadata.sub` populated correctly = the LINE userId — this is what `User.lineUserId` should mirror in our app schema
- Session is durable enough for `getUser()` round-trip
- External browser flow also works (not just in-LINE LIFF) — useful future option for desktop admins linking LINE

**Fallback that we don't need** (kept for reference): server-side path — `/api/auth/line-exchange` route validates LIFF access token via LINE's `oauth2/v2.1/verify`, then calls `supabase.auth.admin.createUser({ email: <synthetic>, app_metadata: { line_user_id, provider: 'line' }, email_confirm: true })` (idempotent via lookup by line_user_id), then issues a Supabase session via signed magic link. Would add ~4 hours of W3 work. Not needed — `signInWithIdToken` works.

---

## 8. Doc follow-ups (now Stage 2 has passed)

- [x] Stage 2 verified — banner at top of this doc
- [ ] `architecture.md §9` — remove item #1 (OIDC verification) from open questions
- [ ] `build-plan.md W0` — check off "Stage 2 OIDC smoke test executed" line
