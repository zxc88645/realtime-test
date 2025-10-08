const express = require('express');
const path = require('path');

function createExpressApp(options) {
  const { publicDirectory } = options;
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  if (publicDirectory) {
    app.use(express.static(path.resolve(publicDirectory)));
  }

  return app;
}

module.exports = { createExpressApp };
