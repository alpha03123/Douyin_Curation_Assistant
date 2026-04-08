export function getLegacyBridgeStatus(legacyProjectPath) {
  return {
    ready: true,
    legacyProjectPath,
    message:
      "The new Node backend now treats the legacy Python project as reference code only. Runtime discovery is being migrated into this project directly.",
  };
}
