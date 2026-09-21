(function (global) {
  let resourceKey = "",
    resourcePromise = null;

  function loadScript(url, globalName) {
    if (global[globalName]) return Promise.resolve();
    const existing = Array.from(document.scripts).find(
      (script) => script.src === new URL(url, document.baseURI).href,
    );
    return new Promise((resolve, reject) => {
      const script = existing || document.createElement("script");
      const loaded = () =>
        global[globalName] ? resolve() : reject(new Error("pdf_resources"));
      script.addEventListener("load", loaded, { once: true });
      script.addEventListener(
        "error",
        () => {
          script.remove();
          reject(new Error("pdf_resources"));
        },
        { once: true },
      );
      if (!existing) {
        script.src = url;
        script.async = true;
        document.head.append(script);
      }
    });
  }

  async function fetchBytes(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error("pdf_resources");
    return new Uint8Array(await response.arrayBuffer());
  }

  function resources(assets) {
    const key = JSON.stringify(assets);
    if (resourcePromise && resourceKey === key) return resourcePromise;
    resourceKey = key;
    resourcePromise = (async () => {
      await loadScript(assets.library, "PDFLib");
      await loadScript(assets.fontkit, "fontkit");
      const files = await Promise.all([
        fetchBytes(assets.logo),
        fetchBytes(assets.font_regular),
        fetchBytes(assets.font_bold),
      ]);
      return { logo: files[0], regular: files[1], bold: files[2] };
    })().catch((error) => {
      resourcePromise = null;
      throw error;
    });
    return resourcePromise;
  }

  function splitWord(word, font, size, width) {
    const parts = [];
    let current = "";
    Array.from(word).forEach((character) => {
      const candidate = current + character;
      if (current && font.widthOfTextAtSize(candidate, size) > width) {
        parts.push(current);
        current = character;
      } else current = candidate;
    });
    if (current) parts.push(current);
    return parts;
  }

  function wrapText(value, font, size, width) {
    const lines = [];
    String(value || "")
      .split(/\r?\n/)
      .forEach((paragraph) => {
        if (!paragraph) {
          lines.push("");
          return;
        }
        let current = "";
        paragraph
          .trim()
          .split(/\s+/)
          .forEach((word) => {
            const pieces =
              font.widthOfTextAtSize(word, size) <= width
                ? [word]
                : splitWord(word, font, size, width);
            pieces.forEach((piece) => {
              const candidate = current ? current + " " + piece : piece;
              if (current && font.widthOfTextAtSize(candidate, size) > width) {
                lines.push(current);
                current = piece;
              } else current = candidate;
            });
          });
        lines.push(current);
      });
    return lines.length ? lines : [""];
  }

  function drawLines(page, lines, font, size, lineHeight, x, top, color) {
    lines.forEach((line, index) =>
      page.drawText(line, {
        x,
        y: top - size - index * lineHeight,
        size,
        font,
        color,
      }),
    );
    return top - lines.length * lineHeight;
  }

  function rowLayout(row, fonts, layout, widths) {
    const labelLines = wrapText(
      row.label,
      fonts.bold,
      layout.body_font_size,
      widths.label - layout.cell_padding * 2,
    );
    const valueLines = wrapText(
      row.value,
      fonts.regular,
      layout.body_font_size,
      widths.value - layout.cell_padding * 2,
    );
    return {
      ...row,
      labelLines,
      valueLines,
      height:
        Math.max(labelLines.length, valueLines.length) *
          layout.body_line_height +
        layout.cell_padding * 2,
    };
  }

  function layoutRows(rows, fonts, layout, widths) {
    return rows.map((row) => rowLayout(row, fonts, layout, widths));
  }

  function tableHeight(rows) {
    return rows.reduce((total, row) => total + row.height, 0);
  }

  function fitTable(rows, fonts, layout, widths, available, annexReference) {
    const values = rows.map((row) => ({ ...row }));
    const annex = [];
    let measured = layoutRows(values, fonts, layout, widths);
    while (tableHeight(measured) > available) {
      const candidates = measured
        .filter((row) => row.annexTitle && row.value !== annexReference)
        .sort((a, b) => b.height - a.height);
      if (!candidates.length) throw new Error("pdf_generation");
      const selected = candidates[0],
        source = values.find((row) => row.label === selected.label);
      annex.push({ title: source.annexTitle, value: source.value });
      source.value = annexReference;
      measured = layoutRows(values, fonts, layout, widths);
    }
    return { rows: measured, annex };
  }

  function drawTable(page, rows, fonts, layout, x, top, width, color) {
    const height = tableHeight(rows),
      bottom = top - height,
      divider = x + layout.label_column_width;
    page.drawRectangle({
      x,
      y: bottom,
      width,
      height,
      borderColor: color,
      borderWidth: layout.rule_width,
    });
    page.drawLine({
      start: { x: divider, y: bottom },
      end: { x: divider, y: top },
      thickness: layout.rule_width,
      color,
    });
    let rowTop = top;
    rows.forEach((row, index) => {
      drawLines(
        page,
        row.labelLines,
        fonts.bold,
        layout.body_font_size,
        layout.body_line_height,
        x + layout.cell_padding,
        rowTop - layout.cell_padding,
        color,
      );
      drawLines(
        page,
        row.valueLines,
        fonts.regular,
        layout.body_font_size,
        layout.body_line_height,
        divider + layout.cell_padding,
        rowTop - layout.cell_padding,
        color,
      );
      rowTop -= row.height;
      if (index < rows.length - 1)
        page.drawLine({
          start: { x, y: rowTop },
          end: { x: x + width, y: rowTop },
          thickness: layout.rule_width,
          color,
        });
    });
    return bottom;
  }

  function addAnnex(pdf, annex, data, fonts, layout, color) {
    if (!annex.length) return;
    const width = layout.page_width - layout.margin * 2;
    let page, y;
    function newPage() {
      page = pdf.addPage([layout.page_width, layout.page_height]);
      y = layout.page_height - layout.margin;
      y =
        drawLines(
          page,
          [data.annexTitle],
          fonts.bold,
          layout.annex_heading_font_size,
          layout.annex_heading_font_size + layout.paragraph_gap,
          layout.margin,
          y,
          color,
        ) - layout.section_gap;
    }
    newPage();
    annex.forEach((section) => {
      const headingHeight = layout.body_line_height + layout.paragraph_gap;
      if (y - headingHeight < layout.margin) newPage();
      y =
        drawLines(
          page,
          [section.title],
          fonts.bold,
          layout.body_font_size,
          layout.body_line_height,
          layout.margin,
          y,
          color,
        ) - layout.paragraph_gap;
      const lines = wrapText(
        section.value,
        fonts.regular,
        layout.body_font_size,
        width,
      );
      lines.forEach((line) => {
        if (y - layout.body_line_height < layout.margin) newPage();
        y = drawLines(
          page,
          [line],
          fonts.regular,
          layout.body_font_size,
          layout.body_line_height,
          layout.margin,
          y,
          color,
        );
      });
      y -= layout.annex_section_gap;
    });
  }

  async function create(data, assets, layout) {
    let loaded;
    try {
      loaded = await resources(assets);
    } catch (error) {
      throw new Error("pdf_resources");
    }
    try {
      const { PDFDocument, rgb } = global.PDFLib,
        pdf = await PDFDocument.create();
      pdf.registerFontkit(global.fontkit);
      const regular = await pdf.embedFont(loaded.regular, { subset: true }),
        bold = await pdf.embedFont(loaded.bold, { subset: true }),
        logo = await pdf.embedPng(loaded.logo),
        fonts = { regular, bold },
        color = rgb(0, 0, 0),
        page = pdf.addPage([layout.page_width, layout.page_height]),
        contentWidth = layout.page_width - layout.margin * 2;
      pdf.setTitle(data.title);
      let y = layout.page_height - layout.margin;
      const logoScale = Math.min(
          layout.logo_max_width / logo.width,
          layout.logo_max_height / logo.height,
        ),
        logoWidth = logo.width * logoScale,
        logoHeight = logo.height * logoScale;
      page.drawImage(logo, {
        x: layout.margin,
        y: y - (layout.header_height + logoHeight) / 2,
        width: logoWidth,
        height: logoHeight,
      });
      const titleX = layout.margin + layout.logo_max_width + layout.header_gap,
        titleWidth = contentWidth - layout.logo_max_width - layout.header_gap;
      if (
        bold.widthOfTextAtSize(data.title, layout.title_font_size) > titleWidth
      )
        throw new Error("pdf_generation");
      const titleHeight = bold.heightAtSize(layout.title_font_size);
      page.drawText(data.title, {
        x: titleX,
        y: y - (layout.header_height + titleHeight) / 2,
        size: layout.title_font_size,
        font: bold,
        color,
      });
      y -= layout.header_height + layout.section_gap;
      const noticeHeight =
        data.depositLines.length * layout.notice_line_height +
        layout.notice_padding * 2;
      page.drawRectangle({
        x: layout.margin,
        y: y - noticeHeight,
        width: contentWidth,
        height: noticeHeight,
        borderColor: color,
        borderWidth: layout.rule_width,
      });
      data.depositLines.forEach((line, index) => {
        const lineWidth = bold.widthOfTextAtSize(line, layout.notice_font_size);
        page.drawText(line, {
          x: layout.margin + (contentWidth - lineWidth) / 2,
          y:
            y -
            layout.notice_padding -
            layout.notice_font_size -
            index * layout.notice_line_height,
          size: layout.notice_font_size,
          font: bold,
          color,
        });
      });
      y -= noticeHeight + layout.section_gap;
      y =
        drawLines(
          page,
          [data.remindersTitle],
          bold,
          layout.section_heading_font_size,
          layout.body_line_height,
          layout.margin,
          y,
          color,
        ) - layout.paragraph_gap;
      data.reminders.forEach((reminder) => {
        const lines = wrapText(
          reminder,
          regular,
          layout.body_font_size,
          contentWidth - layout.bullet_indent,
        );
        page.drawText("•", {
          x: layout.margin,
          y: y - layout.body_font_size,
          size: layout.body_font_size,
          font: regular,
          color,
        });
        y =
          drawLines(
            page,
            lines,
            regular,
            layout.body_font_size,
            layout.body_line_height,
            layout.margin + layout.bullet_indent,
            y,
            color,
          ) - layout.paragraph_gap;
      });
      y -= layout.section_gap - layout.paragraph_gap;
      const widths = {
          label: layout.label_column_width,
          value: contentWidth - layout.label_column_width,
        },
        tableBottomLimit =
          layout.margin +
          layout.signature_height +
          layout.footer_gap +
          layout.body_line_height,
        fitted = fitTable(
          data.rows,
          fonts,
          layout,
          widths,
          y - tableBottomLimit,
          data.annexReference,
        ),
        tableBottom = drawTable(
          page,
          fitted.rows,
          fonts,
          layout,
          layout.margin,
          y,
          contentWidth,
          color,
        ),
        footerBaseline =
          tableBottom - layout.footer_gap - layout.body_font_size,
        halfWidth = contentWidth / 2,
        locationWidth = regular.widthOfTextAtSize(
          data.locationDate,
          layout.body_font_size,
        );
      page.drawText(data.locationDate, {
        x: layout.margin + (halfWidth - locationWidth) / 2,
        y: footerBaseline,
        size: layout.body_font_size,
        font: regular,
        color,
      });
      page.drawText(data.signatureLabel, {
        x: layout.margin + halfWidth + layout.cell_padding,
        y: footerBaseline,
        size: layout.body_font_size,
        font: regular,
        color,
      });
      addAnnex(pdf, fitted.annex, data, fonts, layout, color);
      return await pdf.save({ useObjectStreams: false });
    } catch (error) {
      if (error.message === "pdf_generation") throw error;
      throw new Error("pdf_generation");
    }
  }

  const api = { create, wrapText };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.AbsencePdf = api;
})(globalThis);
