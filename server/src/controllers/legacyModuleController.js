function createDisabledError(moduleName, alternative = "") {
  const error = new Error(
    alternative
      ? `${moduleName} has been temporarily disabled. ${alternative}`
      : `${moduleName} has been temporarily disabled.`
  );
  error.statusCode = 410;
  error.code = "LEGACY_MODULE_DISABLED";
  error.details = {
    moduleName,
    alternative,
  };
  return error;
}

function nextDisabled(moduleName, alternative = "") {
  return (_req, _res, next) => {
    next(createDisabledError(moduleName, alternative));
  };
}

export const actionRulesDisabled = nextDisabled(
  "Action rules",
  "Use /works or /recommend-works to execute direct actions."
);

export const dictionaryDisabled = nextDisabled(
  "Analysis dictionary",
  "Comment analysis now runs without the manual dictionary workflow."
);

export const reviewQueueDisabled = nextDisabled(
  "Review queue",
  "Use /works or /recommend-works to execute direct actions."
);

export const templatesDisabled = nextDisabled(
  "Comment templates",
  "Use direct comment input in /works or /recommend-works."
);
