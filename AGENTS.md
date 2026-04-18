# Tab Harbor Agent Guide

This file captures project-level design and implementation constraints for agents working in this repository.

## Design Direction

1. Tab Harbor is a quiet browser workspace, not a SaaS dashboard, wallpaper page, or gamified productivity product.
2. Preserve the calm / literary / composed identity. Interfaces should feel like a reading desk or paper workspace.
3. Prefer scanability over spectacle. If a change makes the page louder before it makes it clearer, reject it.
4. Keep secondary controls quiet. Theme controls, drawer triggers, archive actions, and helper affordances must not visually outrank tab content.
5. Avoid decorative chrome that does not improve hierarchy, orientation, or atmosphere.

## UI Guardrails

1. Do not rely on hover alone for critical controls or discoverability.
2. Keyboard focus must stay visible and usable.
3. Reduced-motion users must still understand every state change without animation.
4. Compact controls still need comfortable hit targets.
5. Theme changes must update the full environment, not just local controls.

## Frontend Architecture

1. This project is plain HTML, CSS, and ordered `<script>` tags with no bundler or ESM module system.
2. Script load order is part of the runtime contract. Treat changes to `index.html` script order as high impact.
3. Top-level bindings can collide across files. When destructuring from `globalThis`, use file-scoped prefixed aliases instead of shared short names.
4. Keep `extension/app.js` as a thin orchestrator entry. Do not let it grow back into a catch-all runtime file.
5. Prefer responsibility-based module boundaries such as:
   - `ui-helpers.js`
   - `theme-controls.js`
   - `drawer-manager.js`
   - `dashboard-runtime.js`

## Refactor Safety

1. After any script split, actively check for startup-time failures such as `Identifier has already been declared`.
2. A passing `node --test extension/*.test.js` run is necessary but not sufficient for startup refactors.
3. If the page shows static scaffolding but not dynamic tab data, first suspect runtime initialization failure before changing data logic.
4. For startup regressions, inspect real browser console/runtime errors before continuing to refactor.

## Validation

1. Run `node --test extension/*.test.js` after code changes that affect UI structure, script loading, or runtime behavior.
2. For script-loading or initialization changes, also verify the extension in a real browser session.

## Reference

Detailed rationale and lessons learned live in:
- `docs/design-principles-and-lessons.md`
- `.impeccable.md`
