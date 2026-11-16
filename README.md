# rxbillinggenie

Marketing site for Rx Billing Genie Inc. — static HTML, deployed to Netlify from `main`.

## Structure

- `index.html`, `our-app.html`, `about-us.html`, `media.html`, `contact.html`, `blog.html`, `privacy.html`, `terms.html`
- `phmanitoba.html`, `opa.html` — password-protected member pages (see below)
- `blog/` — individual posts
- `partials/nav.html`, `partials/footer.html` — injected client-side via `fetch`
- `css/mobile.css` — shared mobile styles and hamburger nav
- `netlify/edge-functions/` — Netlify Edge Functions

## Password-protected member pages

`netlify/edge-functions/member-page-auth.js` gates the partner/member pages at
the edge, before any HTML reaches the browser.

| Page | Environment variable | Cookie |
| --- | --- | --- |
| `/phmanitoba` | `PHMANITOBA_PASSWORD` | `phmb_auth` |
| `/opa` | `OPA_PASSWORD` | `opa_auth` |

Each page has its own password and its own cookie, so unlocking one does not
unlock the other. Passwords are never committed to this repo and never sent to
the browser.

To set or change one: **Netlify → Site configuration → Environment variables**.

- Scope must include **Edge Functions** (or *All scopes*).
- Use the same value across deploy contexts if you want previews gated too.
- Changes take effect on the next deploy (trigger one after editing the value).

How it works:

| Request | Response |
| --- | --- |
| `GET` without a valid cookie | `401` + login form |
| `POST` with the wrong password | `401` + login form with an error |
| `POST` with the right password | `303` redirect + signed `HttpOnly` cookie |
| `GET` with a valid cookie | the real page |

The cookie holds an expiry and an HMAC-SHA256 of that expiry, keyed on that
page's password — so it carries no secret, it can't be forged, it lapses after
12 hours, and changing the password invalidates every outstanding session from
the next deploy onward.

If a page's environment variable is unset or empty, or anything throws, the
function returns a 503 and that page is never served. It fails closed by
design — and one page failing closed does not affect the other.

Path matching is normalized, so `/opa`, `/opa.html`, `/opa/` and `/OPA.html`
all hit the same gate.

### Adding another member page

1. Create the `.html` page.
2. Add an entry to `GATES` in `member-page-auth.js`, keyed on its path, with
   its own `env` and `cookie` names.
3. Add both `/thing` and `/thing.html` to `config.path` at the bottom of that
   file.
4. Set the environment variable in Netlify and redeploy.

Note: the promo code shown *inside* a member page is separate from that page's
password. Don't reuse one as the other.
