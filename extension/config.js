'use strict';

// Checked-in defaults. Private overrides can extend these via config.local.js.
globalThis.LOCAL_LANDING_PAGE_PATTERNS = Array.isArray(globalThis.LOCAL_LANDING_PAGE_PATTERNS)
  ? globalThis.LOCAL_LANDING_PAGE_PATTERNS
  : [];
globalThis.LOCAL_CUSTOM_GROUPS = Array.isArray(globalThis.LOCAL_CUSTOM_GROUPS)
  ? globalThis.LOCAL_CUSTOM_GROUPS
  : [];
