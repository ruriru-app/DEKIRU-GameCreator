/** Never import a path supplied by a saved project or an HTTP response. */
export async function resolveRuntime(version) {
  if(!['fusuma-1','fusuma-2'].includes(version))throw new Error('Unsupported game runtime');
  const [template,audio,converter,engine,controller,renderer]=await Promise.all([
    import('../Typing/templates/fusuma/manifest.js'),import('../core/audio-manager.js'),
    import('../Typing/core/romaji-converter.js'),import('../Typing/core/typing-engine.js'),
    import('../Typing/templates/fusuma/event-controller.js'),import('../Typing/templates/fusuma/renderer.js'),
  ]);
  return{manifest:template.fusumaManifest,mount({host,project}){
    const audioManager=audio.createAudioManager();
    try{
      const game=renderer.mountFusumaGame({host,project,manifest:template.fusumaManifest,audioManager,
        createEngine:engine.createTypingEngine,convertRomaji:converter.romajiToHiragana,createEventController:controller.createFusumaEventController});
      game.setVolume(project.settings.volume);game.setMuted(project.settings.muted);
      return game;
    }catch(error){audioManager.stopAll();throw error;}
  }};
}
