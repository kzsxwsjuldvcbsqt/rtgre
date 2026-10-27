document.documentElement.classList.add("js-enabled");
window.addEventListener("load", function () {
  document.querySelectorAll(".has-filter-sidebar").forEach(function (layout) {
    layout.classList.add("is-layout-ready");
  });
});
