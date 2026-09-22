# "Run your own table": feasibility (2026-09-22)

Idea: visitors run a table on our site with their own keys. The game runs in their browser, so their keys never
reach our server. They can pick the model for every seat.

User decisions (2026-09-22):
- We do **not** sponsor Jev seats. Users bring a TypeSafe key for a Jev seat.
- Users can change the model of **any** seat, from a list of OpenRouter models we support.
- **No** shared replays and **no** public community page.

## Findings (all checks free)

| Question | Result |
| --- | --- |
| Can the browser call OpenRouter directly? | **Yes.** The CORS preflight on `/api/v1/chat/completions` returns `Access-Control-Allow-Origin: *` and allows the `Authorization`, `HTTP-Referer` and `X-Title` headers we send. |
| One-click "Sign in with OpenRouter" (no key pasting)? | **Yes.** OAuth PKCE: redirect to `https://openrouter.ai/auth?callback_url=…&code_challenge=…&code_challenge_method=S256`, then POST `https://openrouter.ai/api/v1/auth/keys` with `{code, code_verifier, code_challenge_method}`. The exchange endpoint allows any origin (CORS `*`). The result is a normal user-controlled API key. Localhost callbacks work on any port. |
| Can the browser call TypeSafe (Jev) directly? | **No, not today.** `api.typesafe.ai` answers every cross-origin preflight with HTTP 400 and no `Access-Control-Allow-Origin`. I tried `/v1/systemone` and `/v1/models`, from our domains, localhost and typesafe.ai's own domains. The SDK has a `dangerouslyAllowBrowser` option, so browser use seems intended but isn't enabled on the API. |
| Does the game code run in a browser? | **Yes.** The engine, players (including the TypeSafe SDK) and the tournament runner bundle for the browser with esbuild: 437 KB minified, 86 KB gzipped. No Node-only imports. A 40-hand mock tournament played in the browser pane in 28 ms. The runner needs only a small in-memory store (`createGame`, `sink`, `gameCost`, `setStatus`). The database module is imported for types only. |
| Which OpenRouter models can we support? | 444 models in the catalog, all text in and text out. 361 support strict structured outputs, which our player needs for reliable replies. Excluding `:batch`, `:free` and `~alias` variants and router-priced entries leaves **267**. Of those, 242 cost ≤ $0.005 per decision (estimate: 800 prompt + 80 completion tokens). |

## Implications

- **OpenRouter seats:** fully client-side. Users sign in with OpenRouter, or paste a key. Keys are kept only in that
  browser, and only if the user chooses.
- **Jev seats** need one of the following:
  1. TypeSafe enables CORS for browser calls. Best option: no key passes through us. Ask TypeSafe.
  2. A stateless pass-through relay on our server for TypeSafe only. The user's key is forwarded per request and
     never stored or logged. It works now, but the key transits our server, so the trust story is weaker. Needs a
     rate limit and an origin check.
  3. No Jev seat in user tables until option 1 happens. This defeats much of the point.
- **Model list:**
  - A curated "verified" list, checked by a small compatibility probe. The probe makes one or two real calls per
    model, costs a few cents in total, and needs the user's go-ahead.
  - The rest of the 267 candidates are available under "More models (unverified)". Settings are auto-adapted from
    the catalog, as `adaptLineup` already does.
  - The catalog can't tell whether a model accepts `reasoning: {effort: 'none'}`; the probe can.
  - Prices come live from the catalog for the cost estimate.
- **Also needed:**
  - the win-% calculation runs in a Web Worker, so the page stays smooth;
  - the budget cap is enforced in the page;
  - closing the tab ends the game.
