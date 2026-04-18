# Quiet Desk UI Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the new tab experience so it scans faster, feels more like a quiet desk, and keeps the existing calm/productive identity.

**Architecture:** Adjust the extension's existing HTML/CSS-first layout instead of rebuilding the page. Keep the current data flows in `app.js`, add a small amount of supporting UI copy/state wiring, and tighten the visual system so the page becomes more legible without losing its editorial warmth.

**Tech Stack:** Plain HTML, CSS, vanilla JavaScript, Node `node:test`

---

### Task 1: Lock shared design context

**Files:**
- Create: `.github/copilot-instructions.md`
- Modify: `.impeccable.md`

- [ ] **Step 1: Mirror the approved design context into a shared agent instruction file**
- [ ] **Step 2: Keep the project-level design context wording aligned with the approved calm / peaceful / literary direction**

### Task 2: Rework the header, quick access area, and drawer triggers

**Files:**
- Modify: `extension/index.html`
- Modify: `extension/app.js`
- Modify: `extension/style.css`
- Test: `extension/ui-regression.test.js`

- [ ] **Step 1: Add clearer desk-oriented header support content and quick-link framing**
- [ ] **Step 2: Add visible labels/meta for the saved/todo drawer triggers**
- [ ] **Step 3: Wire header and trigger helper copy/counts from existing app state**
- [ ] **Step 4: Update regression coverage for the new structural hooks**

### Task 3: Tighten layout, typography, and interaction clarity

**Files:**
- Modify: `extension/style.css`
- Modify: `extension/app.js`
- Test: `extension/ui-regression.test.js`

- [ ] **Step 1: Replace the current font pairing with a less templated editorial + utility pairing**
- [ ] **Step 2: Reduce foggy surfaces / blur and rebalance page spacing for faster scanning**
- [ ] **Step 3: Strengthen group-nav, section headers, mission cards, and drawer readability**
- [ ] **Step 4: Clarify key copy and risky action labels where they currently feel too implicit**

### Task 4: Verify the refresh

**Files:**
- Test: `extension/*.test.js`

- [ ] **Step 1: Run the extension test suite with Node's test runner**
- [ ] **Step 2: Review failures and adjust HTML/CSS/JS or tests until green**
- [ ] **Step 3: Summarize the user-facing improvements and any residual risk**
