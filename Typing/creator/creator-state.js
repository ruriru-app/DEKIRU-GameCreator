function clone(value) {
  return structuredClone(value);
}

export function createProjectStore(initialProject, { idFactory = () => crypto.randomUUID() } = {}) {
  let project = clone(initialProject);
  let dirty = false;
  let previewDirty = false;
  let unsavedChanges = false;
  let hasProjectFile = false;
  const listeners = new Set();

  function notify() {
    const state = getState();
    for (const listener of listeners) listener(state);
  }

  function edited({ affectsPreview = true } = {}) {
    dirty = true;
    unsavedChanges = true;
    if (affectsPreview) previewDirty = true;
    notify();
  }

  function getState() {
    return { project: clone(project), dirty, previewDirty, unsavedChanges, hasProjectFile };
  }

  function getSnapshot() {
    return clone(project);
  }

  function questionIndex(id) {
    return project.questions.findIndex((question) => question.id === id);
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState,
    getSnapshot,
    loadProject(loadedProject) {
      project = clone(loadedProject);
      dirty = true;
      previewDirty = true;
      unsavedChanges = false;
      hasProjectFile = true;
      notify();
    },
    markSaved(snapshot = project) {
      if (JSON.stringify(snapshot) !== JSON.stringify(project)) return;
      unsavedChanges = false;
      hasProjectFile = true;
      notify();
    },
    setTitle(title) {
      project.title = String(title ?? '');
      edited();
    },
    replaceQuestions(questions) {
      project.questions = questions.map((question) => ({ ...clone(question), id: question.id || idFactory() }));
      edited();
    },
    updateQuestion(id, patch) {
      const index = questionIndex(id);
      if (index < 0) return false;
      project.questions[index] = { ...project.questions[index], ...clone(patch), id };
      edited();
      return true;
    },
    duplicateQuestion(id) {
      const index = questionIndex(id);
      if (index < 0) return null;
      const duplicate = { ...clone(project.questions[index]), id: idFactory() };
      project.questions.splice(index + 1, 0, duplicate);
      edited();
      return duplicate.id;
    },
    removeQuestion(id) {
      const index = questionIndex(id);
      if (index < 0) return false;
      project.questions.splice(index, 1);
      edited();
      return true;
    },
    moveQuestion(id, delta) {
      const index = questionIndex(id);
      if (index < 0) return false;
      const target = Math.max(0, Math.min(project.questions.length - 1, index + Number(delta)));
      if (target === index) return false;
      const [question] = project.questions.splice(index, 1);
      project.questions.splice(target, 0, question);
      edited();
      return true;
    },
    setVolume(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return false;
      project.settings.volume = Math.max(0, Math.min(1, numeric));
      edited({ affectsPreview: false });
      return true;
    },
    setMuted(value) {
      project.settings.muted = Boolean(value);
      edited({ affectsPreview: false });
    },
    markPreviewed() {
      previewDirty = false;
      notify();
    },
    markExported(snapshot = project) {
      if (JSON.stringify(snapshot) !== JSON.stringify(project)) return;
      dirty = false;
      notify();
    },
  };
}
