# Product analytics (PostHog)

The dashboard sends product usage to PostHog through the browser SDK, so the
team can build funnels and retention for the journey that matters here:
**open the dashboard → inspect data → act on the device**.

Implementation: [`frontend/src/services/analytics.ts`](../frontend/src/services/analytics.ts).

## Configuration

Vite only exposes variables prefixed with `VITE_`, so the project key goes in
`frontend/.env` (see [`frontend/.env.example`](../frontend/.env.example)):

| Variable | Purpose |
|----------|---------|
| `VITE_POSTHOG_KEY` | PostHog project API key. Empty/absent → the SDK is never initialised and no data leaves the browser. |
| `VITE_POSTHOG_HOST` | Ingestion host, defaults to `https://us.i.posthog.com`; use `https://eu.i.posthog.com` for EU-hosted projects. |

Find the project API key in PostHog under **Project settings → Project API key**.
Restart `npm run dev` (or rebuild) after changing it — Vite reads env vars at
build time.

## Identity

There are no user accounts in the dashboard, so an operator is identified by a
stable id generated once and kept in `localStorage` (`sensoura-analytics-id`),
with mission context attached: `role`, `mission`, `phase`. The same id is reused
on every visit, which is what makes retention and returning-operator reports
work. `identifyOperator()` accepts extra properties when more context is known.

## Events

| Event | Properties | Where |
|-------|------------|-------|
| `$pageview` | `route` | `RouteAnalytics` in `frontend/src/App.tsx`, one per screen (`dashboard`, `sensors`, `climate`, `commands`, `ai-suggestions`, `settings`) |
| `device_command_sent` | `target`, `action`, `mode` | `frontend/src/pages/Commands.tsx`, after the backend acknowledges a pump/buzzer/system command |
| `ai_suggestion_reviewed` | `suggestion_type`, `decision` | `frontend/src/pages/AISuggestions.tsx`, after an approve or reject |

Sensor readings are never sent — only the route, the command target/action and
the suggestion decision.

## Funnels and retention

A funnel that works out of the box: `$pageview` where `route = dashboard` →
`$pageview` where `route = commands` → `device_command_sent`. For retention, use
the `$pageview` event with the operator as the breakdown unit; the stable id
means a returning operator shows up as the same person.

## Consent

Analytics is on by default for this internal mission dashboard and:

- honours `navigator.doNotTrack` (`respect_dnt: true`);
- can be switched off in **Settings → Product Analytics**, which calls
  `setAnalyticsConsent('denied')` and persists the choice, so the next visit
  starts opted out (`opt_out_capturing_by_default`);
- creates person profiles only for identified operators
  (`person_profiles: 'identified_only'`).

## Tests

`frontend/__tests__/analytics.test.ts` covers initialisation, identification,
event capture, the consent opt-out and the unconfigured (no key) case.
