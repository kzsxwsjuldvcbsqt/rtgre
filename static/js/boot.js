document.documentElement.classList.add("js-enabled");
function markScrolled() {
  document.documentElement.classList.toggle("is-scrolled", window.scrollY > 0);
}
markScrolled();
window.addEventListener("scroll", markScrolled, { passive: true });
window.addEventListener("load", function () {
  document.querySelectorAll(".has-filter-sidebar").forEach(function (layout) {
    layout.classList.add("is-layout-ready");
  });
});
