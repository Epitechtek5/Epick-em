---
name: mobile-ui
description: "Redesign native screens using Epick-em components and accessibility rules"
---

# UI workflow

- Start by inspecting current Games, Stats, Teams screens, common `src/components/ui` primitives, colors and translations. Preserve exact design tokens.
- Build a hierarchy of title, metadata, primary action, secondary actions and danger zone; avoid oversized empty space and action-heavy stacks.
- Prefer native-friendly searchable dropdowns for large lists: clear selection, pagination, loading, empty, retry, dismiss-on-select, keyboard avoidance and portal layering. Don't silently truncate available results.
- Respect safe areas, Android navigation footer, iOS home indicator, scroll views, screen-reader names, minimum touch targets and narrow displays.
- Use existing icon set; do not install a new icon package for a few symbols.
- Make destructive actions visibly dangerous and require confirmation.
- Maintain theme variants (light/dark/system) and English/French translations.
- Keep JSX readable, avoid nested ternaries, duplicated styling, per-item network requests and gratuitous animations.
- Test selection, validation, disabled states, errors, pagination, permissions, and navigation. Native behavior needs emulator/device verification where available.

## Project-wide guarantees
- Read `mobile/AGENTS.md`, the current repository layout and relevant code before acting.
- Keep backend contracts authoritative; never fabricate an endpoint, response field, authorization, or successful runtime test.
- Preserve established React Native / Expo Router / TypeScript / NativeWind architecture and existing theme tokens.
- Prefer small, reviewable diffs with expressive names, whitespace and readable JSX. No unrelated reformatting.
- Source identifiers, diagnostics, comments and technical documentation are English; maintain existing French/English translations.
- Never add a dependency without checking necessity, SDK compatibility, lockfile reproducibility and direct/transitive advisories.
- Run focused tests before broad checks; explicitly report what was not run.
- Do not push, change branches, merge, rebase, or rewrite history unless requested. Preserve required GPG signing.
