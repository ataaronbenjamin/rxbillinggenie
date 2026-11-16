/**
 * Password gate for partner / member pages.
 *
 * Each gated page has its own password, read from its own environment variable
 * on the Netlify site (scope must include Edge Functions). Passwords are never
 * sent to the browser and never stored in this repo.
 *
 * To add another member page: create the .html file, add an entry to GATES
 * below keyed on its path, add both URL variants to `config.path` at the
 * bottom, and set the environment variable in Netlify.
 *
 * Flow, per page:
 *   GET  without a valid cookie  -> 401 + login form
 *   POST with the right password -> 303 + signed HttpOnly cookie
 *   GET  with a valid cookie     -> the real page, via context.next()
 *
 * Each cookie holds an expiry plus an HMAC-SHA256 of that expiry, keyed on that
 * page's password, so it carries no secret and changing the password
 * invalidates every outstanding session from the next deploy onward. Cookies
 * are per-page: unlocking one member page does not unlock any other.
 *
 * Fails closed: if a page's environment variable is missing, or anything
 * throws, the real page is never served.
 */

const GATES = {
  "/phmanitoba": {
    env: "PHMANITOBA_PASSWORD",
    cookie: "phmb_auth",
    title: "PhManitoba",
  },
  "/opa": {
    env: "OPA_PASSWORD",
    cookie: "opa_auth",
    title: "Ontario Pharmacists Association",
  },
};

const SESSION_SECONDS = 60 * 60 * 12; // 12 hours

const encoder = new TextEncoder();

function toHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(value) {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function hmacHex(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

/** Length-independent comparison of two equal-length hex digests. */
function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Compare submitted password to the real one via digests, so length never leaks. */
async function passwordMatches(submitted, actual) {
  if (!submitted) return false;
  return constantTimeEqual(await sha256Hex(submitted), await sha256Hex(actual));
}

async function issueToken(password, now = Date.now()) {
  const expiry = String(now + SESSION_SECONDS * 1000);
  return `${expiry}.${await hmacHex(expiry, password)}`;
}

async function tokenIsValid(token, password, now = Date.now()) {
  if (!token) return false;
  const split = token.lastIndexOf(".");
  if (split < 1) return false;

  const expiry = token.slice(0, split);
  const signature = token.slice(split + 1);
  if (!/^\d+$/.test(expiry)) return false;
  if (now > Number(expiry)) return false;

  return constantTimeEqual(signature, await hmacHex(expiry, password));
}

function readCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** "/OPA.html", "/opa/", "/opa.html" all resolve to the "/opa" gate. */
function normalizePath(pathname) {
  let path = pathname.toLowerCase();
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (path.endsWith(".html")) path = path.slice(0, -5);
  return path;
}

const NO_STORE = "private, no-store, max-age=0";

function htmlResponse(body, status, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": NO_STORE,
      "x-robots-tag": "noindex, nofollow",
      ...extraHeaders,
    },
  });
}

function shell(title, inner) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta name="robots" content="noindex, nofollow"/>
<link rel="icon" type="image/png" href="/favicon.png"/>
<title>${title} — Rx Billing Genie</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500&family=Fraunces:ital,wght@0,300;0,500;1,300&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--navy:#0B2545;--teal:#0F6E56;--teal-mid:#1D9E75;--slate:#344054;--muted:#667085;--border:#E4E7EC;--white:#fff;--bg:#F8FAFB}
body{font-family:'DM Sans',sans-serif;background:var(--bg);color:var(--slate);font-size:15px}
.gate{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem}
.gate-card{background:var(--white);border:0.5px solid var(--border);border-radius:16px;padding:2.5rem;width:100%;max-width:400px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.06)}
.gate-logo{width:72px;margin:0 auto 1.25rem}
.gate-logo img{width:72px;object-fit:contain}
.gate-title{font-family:'Fraunces',serif;font-weight:300;font-size:1.5rem;color:var(--navy);margin-bottom:0.5rem}
.gate-sub{font-size:13px;color:var(--muted);margin-bottom:1.75rem;line-height:1.7}
.gate-input{width:100%;padding:10px 14px;border:0.5px solid var(--border);border-radius:8px;font-size:16px;font-family:'DM Sans',sans-serif;color:var(--slate);outline:none;margin-bottom:0.75rem;letter-spacing:0.5px}
.gate-input:focus{border-color:var(--teal-mid)}
.gate-btn{width:100%;background:var(--teal-mid);color:var(--white);padding:11px;border-radius:8px;font-size:14px;font-weight:500;border:none;cursor:pointer;font-family:'DM Sans',sans-serif}
.gate-btn:hover{background:var(--teal)}
.gate-error{font-size:12px;color:#D92D20;margin-bottom:0.75rem}
.gate-foot{font-size:12px;color:var(--muted);margin-top:1.5rem}
.gate-foot a{color:var(--teal);text-decoration:none}
</style>
</head>
<body>
<div class="gate">
  <div class="gate-card">
    <div class="gate-logo">
      <img src="/images/genie_logo.png" alt="Rx Billing Genie"/>
    </div>
${inner}
  </div>
</div>
</body>
</html>`;
}

function loginPage(title, { showError }) {
  return shell(
    title,
    `    <h1 class="gate-title">${title}</h1>
    <p class="gate-sub">This page is password protected.<br/>Please enter your password to continue.</p>
    ${showError ? '<p class="gate-error">Incorrect password. Please try again.</p>' : ""}
    <form method="POST" autocomplete="on">
      <input type="password" name="password" class="gate-input" placeholder="Enter password" autocomplete="current-password" aria-label="Password" autofocus required/>
      <button type="submit" class="gate-btn">Enter</button>
    </form>
    <p class="gate-foot">Need the password? <a href="/contact.html">Get in touch</a></p>`,
  );
}

function unavailablePage() {
  return shell(
    "Temporarily unavailable",
    `    <h1 class="gate-title">Temporarily unavailable</h1>
    <p class="gate-sub">This page can't be unlocked right now.<br/>Please try again shortly.</p>
    <p class="gate-foot"><a href="/">Return to the homepage</a></p>`,
  );
}

export default async function memberPageAuth(request, context) {
  try {
    const url = new URL(request.url);
    const gate = GATES[normalizePath(url.pathname)];

    // Unknown path means config.path and GATES disagree. Fail closed.
    if (!gate) return htmlResponse(unavailablePage(), 503);

    const password = Netlify.env.get(gate.env);

    // Fail closed: without a configured password the page is never served.
    if (!password || password.trim() === "") {
      return htmlResponse(unavailablePage(), 503);
    }

    if (request.method === "POST") {
      const form = await request.formData();
      const submitted = form.get("password");
      const ok = await passwordMatches(
        typeof submitted === "string" ? submitted : "",
        password,
      );

      if (!ok) {
        return htmlResponse(loginPage(gate.title, { showError: true }), 401);
      }

      const token = await issueToken(password);
      return new Response(null, {
        status: 303,
        headers: {
          location: url.pathname,
          "set-cookie": `${gate.cookie}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`,
          "cache-control": NO_STORE,
        },
      });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { allow: "GET, HEAD, POST", "cache-control": NO_STORE },
      });
    }

    const token = readCookie(request.headers.get("cookie"), gate.cookie);
    if (await tokenIsValid(token, password)) {
      const response = await context.next();
      const gated = new Response(response.body, response);
      gated.headers.set("cache-control", NO_STORE);
      gated.headers.set("x-robots-tag", "noindex, nofollow");
      return gated;
    }

    return htmlResponse(loginPage(gate.title, { showError: false }), 401);
  } catch (error) {
    // Never fall through to a protected page on an unexpected error.
    console.error("member-page-auth failed:", error);
    return htmlResponse(unavailablePage(), 503);
  }
}

export const config = {
  path: ["/phmanitoba", "/phmanitoba.html", "/opa", "/opa.html"],
};

// Exported for local tests only; unused at the edge.
export const __test = {
  GATES,
  issueToken,
  tokenIsValid,
  passwordMatches,
  readCookie,
  constantTimeEqual,
  normalizePath,
  SESSION_SECONDS,
};
