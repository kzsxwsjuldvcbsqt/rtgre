(function () {
  AppUtils.onDOMReady(async function () {
    const data = document.getElementById("tasks-data");
    if (!data) return;
    const context = JSON.parse(data.textContent),
      labels = context.labels,
      model = TasksModel,
      byId = (id) => document.getElementById("tasks-" + id),
      writeAccess = await WriteAccess.acquire(
        [
          context.config.storage_key_prefix,
          context.classId,
          context.schoolYear,
        ].join("_"),
      ),
      store = TasksStore.create(
        context,
        () => localStorage,
        model.validatePayload,
        () => writeAccess.assertWritable(),
      );
    let items = [],
      restoreFailed = false;

    function node(tag, text, className) {
      const element = document.createElement(tag);
      if (text !== undefined) element.textContent = text;
      if (className) element.className = className;
      return element;
    }

    function message(text, error) {
      const element = byId("message");
      element.textContent = text;
      element.hidden = !text;
      element.setAttribute("role", error ? "alert" : "status");
    }

    function errorMessage(error) {
      if (error instanceof SyntaxError) return labels.errors.format;
      return labels.errors[error.message] || labels.errors.storage;
    }

    function icon(name) {
      return byId("item-" + name + "-icon").content.cloneNode(true);
    }

    function persist(nextItems, success) {
      try {
        items = store.save(nextItems);
        restoreFailed = false;
        message(success, false);
        render();
        return true;
      } catch (error) {
        message(errorMessage(error), true);
        return false;
      }
    }

    function itemMenu(item) {
      const menu = node("details", undefined, "menu"),
        summary = node("summary"),
        list = node("div", undefined, "menu-list"),
        remove = node("button", labels.delete, "menu-item-danger");
      summary.setAttribute("aria-label", labels.item_actions);
      remove.type = "button";
      remove.addEventListener("click", () => {
        if (!confirm(labels.delete_confirm)) return;
        persist(
          items.filter((current) => current.id !== item.id),
          labels.deleted,
        );
      });
      summary.append(icon("menu"));
      remove.prepend(icon("delete"));
      list.append(remove);
      menu.append(summary, list);
      return menu;
    }

    function render() {
      const list = byId("list");
      list.replaceChildren();
      if (!items.length)
        list.append(node("p", labels.empty, "empty-state-message"));
      items.forEach((item) => {
        const article = node("article", undefined, "task-item");
        article.append(node("p", item.text, "task-text"), itemMenu(item));
        list.append(article);
      });
      byId("export").disabled = !items.length;
      byId("clear").disabled = !items.length && !restoreFailed;
    }

    AppUtils.bindBlurKeys([byId("input")], {
      multiline: true,
      submit: () => byId("form").requestSubmit(),
    });

    byId("form").addEventListener("submit", (event) => {
      event.preventDefault();
      if (restoreFailed) {
        message(labels.errors.restore, true);
        return;
      }
      try {
        if (items.length >= context.config.max_items) throw new Error("limit");
        const now = new Date().toISOString(),
          item = model.createItem(
            byId("input").value,
            crypto.randomUUID(),
            now,
            context.config,
          );
        if (!persist([item, ...items], labels.added)) return;
        byId("input").value = "";
        byId("input").focus();
      } catch (error) {
        message(errorMessage(error), true);
      }
    });

    byId("export").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(store.payload(items), null, 2)], {
          type: "application/json",
        }),
        url = URL.createObjectURL(blob),
        link = document.createElement("a"),
        date = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = AppUtils.formatText(context.config.export_filename, {
        class: context.classId,
        year: context.schoolYear,
        date,
      });
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    });

    byId("import").addEventListener("click", () => {
      byId("import-file").value = "";
      byId("import-file").click();
    });

    byId("import-file").addEventListener("change", async function () {
      const file = this.files[0];
      if (!file) return;
      if (file.size > context.config.max_import_bytes) {
        message(labels.errors.size, true);
        return;
      }
      try {
        const imported = model.validatePayload(
          JSON.parse(await file.text()),
          context,
        );
        if (items.length && !confirm(labels.import_confirm)) return;
        persist(imported, labels.imported);
      } catch (error) {
        message(errorMessage(error), true);
      }
    });

    byId("clear").addEventListener("click", () => {
      if (!confirm(labels.clear_confirm)) return;
      try {
        store.clear();
        items = [];
        restoreFailed = false;
        message(labels.cleared, false);
        render();
      } catch (error) {
        message(errorMessage(error), true);
      }
    });

    try {
      items = store.load();
    } catch (error) {
      restoreFailed = true;
      message(labels.errors.restore, true);
    }
    if (!writeAccess.writable) message(labels.errors.conflict, true);
    byId("actions").hidden = false;
    byId("app").hidden = false;
    render();
    document.documentElement.dataset.storageReady = "true";
  });
})();
