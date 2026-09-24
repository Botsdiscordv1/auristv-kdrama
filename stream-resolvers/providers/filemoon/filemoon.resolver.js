'use strict';

const { StreamResolver } = require('../../core/resolver.interface');
const { ResolverNotImplementedError } = require('../../core/resolver.errors');
const { PROVIDER_IDS } = require('../../core/resolver.types');
const { isFileMoonUrl } = require('./filemoon.utils');

class FileMoonResolver extends StreamResolver {
  constructor(options = {}) {
    super(PROVIDER_IDS.FILEMOON);
  }

  canResolve(url) {
    return isFileMoonUrl(url);
  }

  async resolve(url, options = {}) {
    throw new ResolverNotImplementedError(this.providerId);
  }
}

module.exports = { FileMoonResolver };