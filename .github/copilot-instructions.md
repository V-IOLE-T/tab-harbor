## Design Context

### Product Overview
Tab Harbor is a calmer Chrome new tab workspace for people who live with many open tabs. It combines open-tab awareness, manual grouping, quick links, saved reads, and lightweight todos in one local-first surface so the browser can feel workable again instead of visually noisy.

### Users
Tab Harbor serves people who keep many browser tabs open while working, switch contexts frequently, and accumulate articles they intend to read. They open a new tab when they need to search, jump back into active work, and tame browsing clutter without leaving the browser.

Typical users include:
- knowledge workers doing research across many sources
- makers and developers juggling documentation, issue threads, and tools
- readers who save articles faster than they can finish them
- people who want a calmer browser workflow without adopting a separate productivity app

### Use Cases
Primary jobs to be done:
1. Re-enter work quickly when opening a new tab.
2. See what is already open before opening more duplicate or forgotten pages.
3. Separate "active now" tabs from "read later" material without losing either.
4. Keep lightweight task reminders close to the browsing context.
5. Tidy tab chaos without turning the browser into a heavy dashboard product.

Secondary jobs:
1. Personalize the workspace through themes, transparency, and background treatment.
2. Jump between groups or content areas quickly from lightweight navigation.
3. Archive or restore content later without anxiety about losing it.

### Brand Personality
Core personality words:
- calm
- literary
- composed

The product should reduce chaos without feeling sterile. It should feel thoughtful, private, and grounded, with the tone of a quiet reading desk rather than a loud productivity tool. It should support focused work with a gentle confidence, not with motivational energy or aggressive optimization language.

### Emotional Goals
The interface should help users feel:
- less visually overwhelmed
- more oriented when returning to work
- quietly in control of a messy browser session
- invited to continue reading, sorting, and acting without friction

It should not make users feel:
- rushed
- gamified
- monitored
- trapped inside a complicated system

### Aesthetic Direction
The visual direction should feel like a quiet reading desk rather than a loud productivity dashboard. The interface should stay editorial and paper-like, while preserving enough clarity and structure for fast scanning during active multitasking.

Desired qualities:
- warm, subtle, and materially believable
- lightweight rather than ornamental
- typographically intentional
- soft in atmosphere, precise in structure

The product should feel closer to a reading surface, pinboard, or annotated workspace than to a metrics dashboard, startup landing page, or neon developer tool.

### Theme Strategy
Default to light or softly tinted themes that support daytime reading and repeated new-tab use. Dark themes may exist, but they should feel muted, paper-like, and low-glare rather than cinematic or high-contrast.

Theme behavior expectations:
1. Neutrals should carry a subtle tint from the active theme.
2. Accent color usage should stay restrained and informative.
3. Theme changes should affect the whole environment, not just isolated buttons.
4. Custom backgrounds are optional atmosphere, never the main content.
5. Readability and scanability take precedence over visual flourish in every theme.

### References
Positive reference qualities:
- editorial interfaces with strong typography and restrained rhythm
- desk, notebook, library, and reading-material cues
- lightweight productivity tools that feel personal rather than corporate
- interfaces that communicate calm through spacing, contrast, and structure instead of empty minimalism

Reference the feeling, not the literal styling: we want the discipline of a well-arranged workspace, not nostalgia cosplay or skeuomorphic decoration.

### Anti-References
Tab Harbor should explicitly avoid looking like:
- a generic SaaS dashboard
- a glowing dark-mode developer homepage
- a wallpaper-first new tab page
- a gamified productivity tracker
- a card-heavy settings panel with thick borders and loud accents

Avoid:
- flashy gradients and neon contrast
- oversized hero-style metrics or promotional layout patterns
- decorative chrome that competes with browsing content
- UI that feels like an app launcher instead of an active workspace

### Design Principles
1. Calm first, but never vague: soothe the interface without hiding what matters.
2. Reading-friendly density: support heavy tab usage and article triage with strong scanability.
3. Gentle hierarchy: use contrast, spacing, and typography to guide attention without shouting.
4. Workspace, not wallpaper: every decorative choice should reinforce a thoughtful working surface.
5. Local and lightweight: the UI should feel immediate, private, and frictionless.
6. Personal, not performative: the interface should feel like a tool someone lives in, not a product trying to impress them.

### Interaction Preferences
1. Favor whitespace and simplicity over persistent explanation. If an interface element can be learned through use, avoid always-visible helper copy.
2. Use words sparingly. Prefer clear structure, spacing, and visual cues before adding labels or descriptive text.
3. Secondary controls should stay quiet. Drawer triggers, theme controls, and similar utilities should not compete with core browsing content.
4. Keep framing subtle. Large borders, thick outlines, or heavy container shapes should be reduced unless they serve a strong structural purpose.
5. Theme controls should feel compact and tool-like, not like a separate feature area. Keep proportions balanced and avoid tall, stretched option cards.
6. Theme previews are palette samples, not decorative icons. They should read as concise material swatches.
7. Empty and archived states should teach lightly through structure and action, not through long explanatory paragraphs.
8. Interactions should feel immediate and local. Prefer lightweight transitions and visible effect over theatrical motion.

### Visual Constraints
1. Reduce auxiliary UI noise first: borders, shadows, helper copy, and oversized controls should all be questioned before adding new elements.
2. Theme surfaces, hover states, tooltips, underline accents, and archive actions should derive from theme variables instead of hard-coded colors.
3. Adjustable controls should have visible effect. If a slider changes transparency or depth, the related surfaces must respond clearly enough to perceive.
4. Decorative elements must support orientation, atmosphere, or hierarchy. If they do none of those, remove them.
5. Avoid excessive card nesting. Flatten structure whenever content can stand on spacing and alignment alone.
6. Keep visual weight concentrated around content and utility, not around containers.

### Typography Guidance
1. Typography is a primary identity layer for this product, not just a utility decision.
2. Favor readable, characterful type pairings that support an editorial and literary tone.
3. Long text should feel comfortable for reading, but UI labels must stay crisp for scanning.
4. Size contrast should create hierarchy without turning the page into a marketing composition.
5. Avoid over-compressed, overly geometric, or trendy "tech brand" typography choices.

### Motion Guidance
1. Motion should clarify focus changes, panel behavior, hover feedback, and state transitions.
2. Prefer soft, brief, decelerating motion over springy or playful movement.
3. Motion should reinforce calmness and immediacy, never spectacle.
4. Reduced-motion users must retain full clarity of state without depending on animation.

### Accessibility Requirements
Baseline expectations:
1. Preserve clear keyboard navigation and visible focus states.
2. Maintain readable contrast across all supported themes.
3. Do not rely on color alone to communicate selection, state, or priority.
4. Support reduced-motion preferences for transitions and panel behavior.
5. Keep hit targets comfortable for repeated use, especially in compact utility controls.

Accessibility here is part of the emotional design: users should feel oriented and safe, not visually strained.

### Theme Panel Guidelines
1. The theme panel should read as a compact utility surface, not a feature page. Prefer balanced proportions over tall, narrow stacks.
2. Theme options should feel like concise selections, not content cards. Keep them short, low in height, and visually uniform.
3. Remove non-essential copy inside the panel. Use section labels and primary option names before adding extra description.
4. The theme option swatch represents the palette relationship: background or paper on one side, accent on the other. Treat it as a material sample, not an icon.
5. The panel shell and inner option shapes should belong to the same visual family. Outer radius, inner radius, spacing, and stroke weight should feel intentionally related.
6. Panel borders must stay subtle. If the container outline becomes a dominant visual element, reduce it.
7. Clicking anywhere outside the panel should close it. Theme controls should feel lightweight and easy to dismiss.
8. Theme-dependent details must stay synchronized: panel surface, option states, slider rail and thumb, tooltips, hover shadows, underline accents, and archive action colors should all respond to the active theme.

### Durable Decision Rules
Use these rules when a future design decision is ambiguous:
1. Prefer calmer over louder.
2. Prefer more legible over more decorative.
3. Prefer stronger structure over more copy.
4. Prefer local usefulness over feature theater.
5. Prefer a surface that supports returning to work over one that tries to impress on first glance.

## Implementation Guardrails

### UI Direction
1. Treat Tab Harbor as a quiet browser workspace, not a SaaS dashboard, wallpaper page, or gamified productivity tool.
2. Preserve the calm / literary / composed direction. New UI should feel like a reading desk or paper workspace, not a glowing developer tool.
3. Prefer scanability over spectacle. If a visual treatment makes the page louder before it makes it clearer, reject it.
4. Keep secondary controls quiet. Drawer triggers, theme controls, archive affordances, and helper actions must not compete with open-tab content.
5. Avoid excessive card nesting, oversized status surfaces, and decorative chrome that does not improve orientation, hierarchy, or atmosphere.

### Interaction And Accessibility
1. Critical actions must not depend on hover alone. Keyboard focus states must be visible and usable.
2. Use reduced-motion-safe interactions. Motion should clarify state changes, never be required to understand them.
3. Keep compact controls comfortably clickable. Do not optimize visual minimalism at the expense of hit area or usability.
4. Theme updates must propagate to the whole environment, including surfaces, hover states, tooltips, slider parts, archive actions, and underline accents.

### Frontend Architecture
1. This project uses plain HTML, CSS, and ordered `<script>` tags with no bundler. Treat script load order as part of the runtime contract.
2. In this environment, top-level `const`, `let`, and `function` declarations can conflict across files. When destructuring from `globalThis`, always use file-scoped prefixed aliases.
3. Keep `extension/app.js` as a thin orchestrator entry. Put substantial runtime logic in supporting files instead of growing the entry file again.
4. Prefer module boundaries by responsibility: UI helpers, theme controls, drawer management, dashboard runtime, and feature-specific subsystems.

### Refactor Safety
1. After any script split, rename top-level bindings defensively to avoid `Identifier has already been declared` startup failures.
2. A green `node --test extension/*.test.js` run is necessary but not sufficient for refactors that touch startup or script loading.
3. When the UI shows only static structure but not dynamic tab content, first suspect startup-time script errors before changing data logic.
4. For startup or module-loading regressions, verify the page in a real browser and inspect console/runtime exceptions before deeper code changes.

### Reference
For fuller rationale and concrete lessons learned, see `docs/design-principles-and-lessons.md`.
