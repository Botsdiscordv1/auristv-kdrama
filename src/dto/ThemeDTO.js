function toThemeDTO(theme = {}) {
  const type = (theme.type || '').toUpperCase();
  return {
    type: type === 'ED' ? 'ENDING' : type === 'OP' ? 'OPENING' : type || 'UNKNOWN',
    title: theme.songName || theme.title || '',
    artist: theme.artist || null,
    video: theme.videoUrl || theme.video || null,
    audio: theme.audioUrl || theme.audio || null,
    sequence: theme.sequence ?? 0,
  };
}

function toThemeListDTO(themes = []) {
  return themes.map(toThemeDTO);
}

module.exports = { toThemeDTO, toThemeListDTO };