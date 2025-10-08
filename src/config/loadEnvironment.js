const path = require('path');
const dotenv = require('dotenv');

function loadEnvironment(options = {}) {
  const { envPath = path.resolve(process.cwd(), '.env') } = options;

  const result = dotenv.config({ path: envPath });
  if (result.error && result.error.code !== 'ENOENT') {
    throw result.error;
  }

  return result.parsed ?? {};
}

module.exports = { loadEnvironment };
