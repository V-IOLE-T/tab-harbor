'use strict';

// Checked-in defaults used by every runtime context. Extension pages may add
// private grouping overrides through optional config.local.js. The page
// publishes a declarative snapshot for background reconciliation; function
// predicates remain page-only so the worker never evaluates stored code.
globalThis.LOCAL_LANDING_PAGE_PATTERNS = Array.isArray(globalThis.LOCAL_LANDING_PAGE_PATTERNS)
  ? globalThis.LOCAL_LANDING_PAGE_PATTERNS
  : [];
globalThis.LOCAL_CUSTOM_GROUPS = Array.isArray(globalThis.LOCAL_CUSTOM_GROUPS)
  ? globalThis.LOCAL_CUSTOM_GROUPS
  : [];
