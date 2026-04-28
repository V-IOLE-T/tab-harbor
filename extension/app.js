'use strict';

const {
  mountDashboardRuntime: appMountDashboardRuntime,
} = globalThis.TabHarborDashboardRuntime || {};

const {
  ready: appI18nReady,
} = globalThis.TabHarborI18n || {};

async function initializeApp() {
  if (!appMountDashboardRuntime) {
    throw new Error('Tab Harbor dashboard runtime is unavailable');
  }

  if (appI18nReady && typeof appI18nReady.then === 'function') {
    await appI18nReady;
  }

  await appMountDashboardRuntime();
}

initializeApp();
