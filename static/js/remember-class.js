(function () {
  const script = document.currentScript;
  const storageKey = "selected_class";
  try {
    const currentClass = script.dataset.rememberClass;
    if (currentClass) {
      localStorage.setItem(storageKey, currentClass);
      return;
    }
    const classUrls = JSON.parse(script.dataset.classUrls || "{}");
    const savedClass = localStorage.getItem(storageKey);
    if (
      savedClass &&
      Object.prototype.hasOwnProperty.call(classUrls, savedClass)
    ) {
      window.location.replace(classUrls[savedClass]);
    }
  } catch (error) {
    return;
  }
})();
