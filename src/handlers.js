// -----------------------------------------------------------------------------
// The SDK handlers, wired to the app. Shared by index.js and the end-to-end
// tests, so the tests run the exact wiring of the container.
// -----------------------------------------------------------------------------

import { ACTIONS } from './constants.js';

export function registerHandlers(gladys, app, logger) {
  // Discovery: the devices are published as soon as the gateway sends its configuration.
  gladys.onScanRequest(() => app.scan());
  gladys.onDeviceCreated((device) => app.deviceCreated(device));
  gladys.onDeviceUpdated((device) => app.deviceCreated(device));
  gladys.onDeviceDeleted((device) => app.deviceDeleted(device));

  // Commands: lights, relays, shutters, scenes, setpoints (refused unless allowed).
  gladys.onSetValue((device, feature, value) => app.setValue(device, feature, value));

  // Configuration screen button.
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());

  // Configuration changed by the user.
  gladys.onConfigUpdated((config) => {
    logger?.info('Configuration updated');
    return app.configUpdated(config);
  });

  // Connection lifecycle: the status, the Discovery and the badges are sent
  // again on every connection (the core keeps them in memory only).
  gladys.on('connected', async () => {
    try {
      await app.gladysConnected(await gladys.getConfig());
    } catch (err) {
      logger?.error('Start failed', err);
    }
  });
}
