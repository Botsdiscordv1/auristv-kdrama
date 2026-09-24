const { extract } = require('../../services/extractors');

class ExtractService {
  async extract(url, source, options = {}) {
    return extract(url, source, options);
  }
}

module.exports = { ExtractService };