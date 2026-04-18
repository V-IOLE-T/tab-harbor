'use strict';

const {
  mountDashboardRuntime: appMountDashboardRuntime,
} = globalThis.TabHarborDashboardRuntime || {};

async function initializeApp() {
  if (!appMountDashboardRuntime) {
    throw new Error('Tab Harbor dashboard runtime is unavailable');
  }

  await appMountDashboardRuntime();
}

initializeApp();
