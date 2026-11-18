AppUtils.onDOMReady(function () {
  function address(file) {
    return new URL(file, document.baseURI);
  }

  document.querySelectorAll("[data-feed-subscribe]").forEach(function (link) {
    const target = address(link.getAttribute("href"));
    link.href = "webcal://" + target.host + target.pathname;
  });

  document.querySelectorAll("[data-feed-copy]").forEach(function (button) {
    const label = button.querySelector(".btn-label");
    const initial = Array.from(label.childNodes);
    let timer = null;
    button.addEventListener("click", function () {
      navigator.clipboard
        .writeText(address(button.dataset.feedCopy).href)
        .then(function () {
          label.textContent = button.dataset.copied;
          clearTimeout(timer);
          timer = setTimeout(
            function () {
              label.replaceChildren.apply(label, initial);
            },
            parseInt(button.dataset.messageDuration, 10),
          );
        });
    });
  });
});
