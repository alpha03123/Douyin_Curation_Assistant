export function notFoundHandler(req, res) {
  res.status(404).json({
    error: "Not Found",
    path: req.originalUrl,
  });
}

export function errorHandler(error, req, res, next) {
  const statusCode = error.statusCode || 500;
  const message =
    error?.issues?.[0]?.message || error.message || "Internal Server Error";

  res.status(statusCode).json({
    error: message,
    code: error.code || null,
    details: error.details || null,
  });
}
