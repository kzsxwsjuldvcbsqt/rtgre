(function (global) {
  function stripAccents(str) {
    if (!str) return '';
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function slugify(str) {
    if (!str) return '';
    var cleaned = stripAccents(str).toLowerCase();
    return cleaned.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function parseHash(hashStr) {
    var result = {};
    if (!hashStr || hashStr === '#') return result;
    var raw = hashStr.substring(1);
    var parts = raw.split('&');
    parts.forEach(function (part) {
      var pair = part.split('=');
      if (pair.length === 2) {
        result[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1]);
      }
    });
    return result;
  }

  function buildHash(obj) {
    var parts = [];
    Object.keys(obj).forEach(function (key) {
      if (obj[key] !== null && obj[key] !== undefined && obj[key] !== '') {
        parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(obj[key]));
      }
    });
    return parts.length > 0 ? '#' + parts.join('&') : '';
  }

  function safeStorageGet(key, isSession) {
    try {
      var storage = isSession ? window.sessionStorage : window.localStorage;
      return storage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function safeStorageSet(key, val, isSession) {
    try {
      var storage = isSession ? window.sessionStorage : window.localStorage;
      storage.setItem(key, val);
    } catch (e) {}
  }

  function safeStorageRemove(key, isSession) {
    try {
      var storage = isSession ? window.sessionStorage : window.localStorage;
      storage.removeItem(key);
    } catch (e) {}
  }

  function onDOMReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  global.AppUtils = {
    stripAccents: stripAccents,
    slugify: slugify,
    parseHash: parseHash,
    buildHash: buildHash,
    safeStorageGet: safeStorageGet,
    safeStorageSet: safeStorageSet,
    safeStorageRemove: safeStorageRemove,
    onDOMReady: onDOMReady
  };

  onDOMReady(function () {
    var toggles = Array.prototype.slice.call(document.querySelectorAll('.nav-toggle'));
    toggles.forEach(function (toggle) {
      toggle.addEventListener('click', function () {
        var menuId = toggle.getAttribute('aria-controls');
        var menu = document.getElementById(menuId);
        if (!menu) return;
        var isExpanded = toggle.getAttribute('aria-expanded') === 'true';
        var nextExpanded = !isExpanded;
        toggle.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
        menu.classList.toggle('nav-open', nextExpanded);
        document.body.classList.toggle('nav-open-lock', nextExpanded);
      });
    });

    var navMenus = Array.prototype.slice.call(document.querySelectorAll('.nav-menu'));
    navMenus.forEach(function (menu) {
      var links = Array.prototype.slice.call(menu.querySelectorAll('a'));
      links.forEach(function (link) {
        link.addEventListener('click', function () {
          menu.classList.remove('nav-open');
          document.body.classList.remove('nav-open-lock');
          toggles.forEach(function (t) {
            t.setAttribute('aria-expanded', 'false');
          });
        });
      });
    });

    var headingToggles = Array.prototype.slice.call(document.querySelectorAll('.heading-toggle-btn'));
    headingToggles.forEach(function (btn) {
      var targetId = btn.getAttribute('aria-controls');
      var targetEl = document.getElementById(targetId);
      if (!targetEl) return;

      var storageKey = 'heading_toggle_' + targetId;
      var savedState = safeStorageGet(storageKey);

      if (savedState === 'collapsed') {
        btn.setAttribute('aria-expanded', 'false');
        targetEl.hidden = true;
        var arrowInit = btn.querySelector('.toggle-arrow');
        if (arrowInit) {
          arrowInit.classList.add('is-collapsed');
        }
      } else if (savedState === 'expanded') {
        btn.setAttribute('aria-expanded', 'true');
        targetEl.hidden = false;
        var arrowInitExp = btn.querySelector('.toggle-arrow');
        if (arrowInitExp) {
          arrowInitExp.classList.remove('is-collapsed');
        }
      }

      btn.addEventListener('click', function () {
        var isExpanded = btn.getAttribute('aria-expanded') === 'true';
        var nextExpanded = !isExpanded;
        btn.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
        targetEl.hidden = !nextExpanded;
        var arrow = btn.querySelector('.toggle-arrow');
        if (arrow) {
          arrow.classList.toggle('is-collapsed', !nextExpanded);
        }
        safeStorageSet(storageKey, nextExpanded ? 'expanded' : 'collapsed');
      });
    });
  });
})(this);
