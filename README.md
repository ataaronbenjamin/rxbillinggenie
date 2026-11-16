# rxbillinggenie

Marketing site for Rx Billing Genie Inc. — static HTML, deployed to Netlify from `main`.

## Structure

- `index.html`, `our-app.html`, `about-us.html`, `media.html`, `contact.html`, `blog.html`, `privacy.html`, `terms.html`
- `phmanitoba.html` — password-protected Pharmacists Manitoba page (see below)
- `blog/` — individual posts
- `partials/nav.html`, `partials/footer.html` — injected client-side via `fetch`
- `css/mobile.css` — shared mobile styles and hamburger nav
- `netlify/edge-functions/` — Netlify Edge Functions

## Password protection for /phmanitoba

`netlify/edge-functions/phmanitoba-auth.js` gates `/phmanitoba` and
`/phmanitoba.html` at the edge, before any HTML reaches the browser.

The password is read from the **`PHMANITOBA_PASSWORD`** environment variable on
the Netlify site. It is never committed to this repo and never sent to the
browser.

To set or change it: **Netlify → Site configuration → Environment variables**.

- Scope must include **Edge Functions** (or *All scopes*).
- Include the **Deploy previews** context if you want previews gated too.
- Changes take effect on the next deploy (trigger one after editing the value).

How it works:

| Request | Response |
| --- | --- |
| `GET` without a valid cookie | `401` + login form |
| `POST` with the wrong password | `401` + login form with an error |
| `POST` with the right password | `303` redirect + signed `HttpOnly` cookie |
| `GET` with a valid cookie | the real page |

The cookie holds an expiry and an HMAC-SHA256 of that expiry, keyed on the
password itself — so it carries no secret, it can't be forged, it lapses after
12 hours, and changing the password in Netlify immediately invalidates every
outstanding session.

If `PHMANITOBA_PASSWORD` is unset or empty, or anything throws, the function
returns a 503 and the page is never served. It fails closed by design.

Note: the promo code shown *inside* the page is separate from the page
password. Don't reuse one as the other.
