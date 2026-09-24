const VERSION = '3.0';

function toHealthDTO(providers = []) {
  return {
    status: providers.every(p => p.status === 'ONLINE') ? 'healthy' : 'degraded',
    uptime: Math.floor(process.uptime()),
    version: VERSION,
    providers: providers.map(p => ({
      provider: p.provider,
      status: p.status || 'UNKNOWN',
      responseTime: p.responseTime ?? 0,
      lastSuccess: p.lastSuccess || null,
    })),
  };
}

module.exports = { toHealthDTO };