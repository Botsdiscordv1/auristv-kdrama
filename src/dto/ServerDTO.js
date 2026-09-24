function toServerDTO(server = {}) {
  return {
    id: server.id || server.name ? `${server.name}-${server.language || 'es'}` : null,
    name: server.name || 'Unknown',
    type: server.type || 'direct',
    quality: server.quality || null,
    language: server.language || 'es',
    isWorking: server.isWorking ?? true,
  };
}

function toServerListDTO(servers = []) {
  return servers.map(toServerDTO);
}

module.exports = { toServerDTO, toServerListDTO };