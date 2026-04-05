module.exports = (err, req, res, next) => {
  const status = err.status || 500;
  const code = err.code || 'INTERNAL_SERVER_ERROR';
  const message = err.message || 'Internal Server Error';

  res.status(status).json({
    success: false,
    error: {
      code,
      message
    }
  });
};
