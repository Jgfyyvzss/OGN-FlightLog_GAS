//X_ExportRegistry.gs
const X_ExportRegistry = (() => {
  const exports = [];

  function register(def) {
    exports.push(def);
  }

  function all() {
    return exports;
  }

  return { register, all };
})();
