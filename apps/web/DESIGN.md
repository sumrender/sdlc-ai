# Design

<!-- impeccable:design-schema 1 -->

## World: Cloudflare-Dash Ops (pinned brief)

User-pinned: look and feel like the Cloudflare dashboard (light, crisp, dense
ops console). This overrides the earlier Launch-Ops dark concept entirely.
Reference: light gray app ground, white cards with hairline borders and 8px
radii, left icon sidebar with grouped nav, breadcrumb top bar, tab strip
(Overview / Metrics / Deployments / … style), blue primary actions
(#2b5feb-ish), orange Cloudflare mark accent, mono for SHAs/ids/commands,
quiet gray text, blue link affordances. No dark mode, no phosphor, no glow.

## Palette

- App ground: `#f3f4f6`-ish (`--background`), panels white (`--card`),
  hairline borders `#e5e7eb` (`--border`).
- Text: near-black `#111827` foreground, secondary `#6b7280`
  (muted-foreground), faint `#9ca3af`.
- Primary action blue: `#2563eb` (`--primary` as blue; foreground white).
  Links blue `#1d4ed8`-ish. Cloudflare orange `#f6821f` reserved for the
  product mark + tiny live dots only.
- Signal semantics kept quiet (CF is calm): success emerald, warning amber,
  destructive red, info blue — badges are soft tinted backgrounds, never glow.

## Typography

- System UI stack (match CF: -apple-system/Segoe/Roboto/Inter). Base 13–14px,
  dense. Headings semibold, tight. Tabular mono for ids/SHAs/times/commands.
- No display face, no condensed caps, no wide tracking. Uppercase micro-labels
  only where CF uses them (sidebar group captions).

## Material & Depth

- White cards, 1px `#e5e7eb` borders, `8px` radius, subtle shadow only on
  popovers/dialogs. No elevation on plain cards (CF cards sit flat on gray).
- Sidebar white with right hairline; active item light-gray pill.
- Focus rings blue with offset; selection light blue; scrollbars native thin.

## Composition (mapped to CF patterns)

- **App shell**: left sidebar (product mark, account switcher, grouped nav:
  Pipeline → Board / Task detail context / Activity; Operate → Deployments,
  Reviews, Tests; Configure → Settings), top bar with breadcrumb
  (AI powered SDLC › Board / task title), right side Ask/Support-ish actions replaced
  by Run Demo / Reset Demo / New Task. Board page gets a CF-style tab strip
  (Board / Activity / Deployments anchors).
- **Board**: gray ground, 7 compact columns as white cards with gray header
  band (stage name + count pill like CF's Domains `2` count chips), task rows
  like CF version-list rows (mono short-sha/issue chip, title, branch pill,
  age, status pill, chevron). Waiting rows get amber left tick + callout bar.
- **Task detail**: CF service page — breadcrumb + status banner row, tab strip
  (Overview / Plan / Reviews / Tests / Deployments / Logs / Events), center
  content card with version-list-style run rows, right rail cards (Domains and
  routes → GitHub & routes; Usage → E2E proof counts; Next steps → approvals).
- **Settings**: calibration-sheet card grid like CF Bindings/Manifest cards.

## Motion

CF-quiet: no authored pulse. Keep existing card spring on stage change only;
respect prefers-reduced-motion. SSE reconnect notice as plain amber banner.

## States & Copy

- WAITING = amber banner naming the need + action button adjacent.
- FAILED = red banner + error + retry adjacent. RUNNING = blue pill + agent
  name. Empty columns show CF-style muted placeholder rows ("No workers bound…"
  tone: "No tasks in PLANNING").
- Voice: keep product terms (stages, agents, gates) and all factual copy.
