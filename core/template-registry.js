export function createTemplateRegistry() {
  const templates = new Map();

  function keyFor(gameType, id) {
    return `${gameType}:${id}`;
  }

  return {
    register(manifest) {
      if (!manifest?.gameType || !manifest?.id) {
        throw new TypeError('Template manifest requires gameType and id.');
      }
      const key = keyFor(manifest.gameType, manifest.id);
      if (templates.has(key)) throw new Error(`Template ${key} is already registered.`);
      templates.set(key, manifest);
      return manifest;
    },

    get(gameType, id) {
      return templates.get(keyFor(gameType, id)) ?? null;
    },

    list(gameType) {
      return [...templates.values()].filter((manifest) => manifest.gameType === gameType);
    },
  };
}
