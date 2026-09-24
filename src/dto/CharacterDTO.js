function toCharacterDTO(char = {}) {
  return {
    id: char.id ? String(char.id) : null,
    name: char.name?.full || char.name || '',
    image: char.image || char.thumbnail || null,
    role: char.role || 'UNKNOWN',
    voiceActors: (char.voiceActors || char.voiceActors || []).map(toVoiceActorDTO),
  };
}

function toVoiceActorDTO(va = {}) {
  return {
    id: va.id ? String(va.id) : null,
    name: va.name?.full || va.name || '',
    language: va.language || 'japanese',
    image: va.image || va.thumbnail || null,
  };
}

function toCharacterListDTO(characters = []) {
  return characters.map(toCharacterDTO);
}

module.exports = { toCharacterDTO, toCharacterListDTO };