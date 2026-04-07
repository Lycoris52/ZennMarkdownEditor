(function () {
  let isDirty = false;
  let isSaving = false;
  let lastSavedSnapshot = "";
  let autosaveTimer = null;
  let featuredImageFrame = null;

  function getSaveButton() {
    return document.getElementById("mpe-save-post");
  }

  function stateHasSavedPost() {
    const postId = document.getElementById("mpe-post-id");
    return Boolean(postId && postId.value && postId.value !== "0");
  }

  function updateSaveButtonState(mode) {
    const saveButton = getSaveButton();
    if (!saveButton) {
      return;
    }

    saveButton.classList.remove("is-idle", "is-dirty", "is-saving", "is-saved");

    if (mode === "dirty") {
      saveButton.classList.add("is-dirty");
      saveButton.textContent = MPE_Admin.saveButtonDirtyText;
      saveButton.disabled = false;
      return;
    }

    if (mode === "saving") {
      saveButton.classList.add("is-saving");
      saveButton.textContent = MPE_Admin.saveButtonSavingText;
      saveButton.disabled = true;
      return;
    }

    if (mode === "saved") {
      saveButton.classList.add("is-saved");
      saveButton.textContent = "\u2713 " + MPE_Admin.saveButtonSavedText;
      saveButton.disabled = false;
      return;
    }

    saveButton.classList.add("is-idle");
    saveButton.textContent = MPE_Admin.saveButtonIdleText;
    saveButton.disabled = false;
  }

  function escapeHtml(value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getFootnoteReferenceId(footnoteId, referenceIndex) {
    const safeId = footnoteId.replace(/[^a-zA-Z0-9_-]/g, "-");
    return `mpe-fnref-${safeId}-${referenceIndex}`;
  }

  function getFootnoteItemId(footnoteId) {
    const safeId = footnoteId.replace(/[^a-zA-Z0-9_-]/g, "-");
    return `mpe-fn-${safeId}`;
  }

  function renderFootnoteReference(footnoteId, state) {
    if (!state.items[footnoteId]) {
      state.items[footnoteId] = {
        number: state.nextNumber,
        references: 0
      };
      state.nextNumber += 1;
    }

    state.items[footnoteId].references += 1;
    const referenceIndex = state.items[footnoteId].references;
    const number = state.items[footnoteId].number;
    return `<sup class="mpe-footnote-ref" id="${getFootnoteReferenceId(footnoteId, referenceIndex)}"><a href="#${getFootnoteItemId(footnoteId)}">${number}</a></sup>`;
  }

  function plainTextFromInline(text) {
    return String(text || "")
      .replace(/!\[([^\]]*)\]\((.*?)\)/g, "$1")
      .replace(/\[([^\]]+)\]\((.*?)\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\^\[([^\]]+)\]|\[\^([^\]]+)\]/g, "")
      .replace(/(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/gs, "$1")
      .replace(/[*_~#]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeAnchorTarget(text) {
    const normalized = plainTextFromInline(text).replace(/\s+/g, " ").trim();

    if (!normalized) {
      return "mpe-section";
    }

    if (/^[A-Za-z0-9 _-]+$/.test(normalized)) {
      const asciiSlug = normalized
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9_-]/g, "")
        .replace(/^-+|-+$/g, "");
      return asciiSlug || "mpe-section";
    }

    return `mpe-${encodeURIComponent(normalized).toLowerCase().replace(/%/g, "-")}`;
  }

  function renderInline(text, preserveLineBreaks, footnotes, footnoteState) {
    const safeText = String(text || "");
    const noteMap = footnotes || {};
    const noteState = footnoteState || {
      nextNumber: 1,
      items: {},
      inlineNext: 1
    };
    const placeholders = [];
    let output = safeText;

    output = output.replace(/!\[([^\]]*)\]\((\S+?)(?:\s+=([0-9]+)x)?\)/g, function (_, alt, url, width) {
      const style = width
        ? ` style="width:${parseInt(width, 10)}px; max-width:100%; height:auto;"`
        : ' style="max-width:100%; height:auto;"';
      const token = `@@MPE${placeholders.length}@@`;
      placeholders.push(`<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}"${style} />`);
      return token;
    });

    output = output.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|#[^)]+)\)/g, function (_, label, url) {
      const token = `@@MPE${placeholders.length}@@`;
      const href = url.charAt(0) === "#" ? `#${normalizeAnchorTarget(url.slice(1))}` : url;
      placeholders.push(`<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`);
      return token;
    });

    output = output.replace(/`([^`]+)`/g, function (_, code) {
      const token = `@@MPE${placeholders.length}@@`;
      placeholders.push(`<code>${escapeHtml(code)}</code>`);
      return token;
    });

    output = output.replace(/\^\[([^\]]+)\]|\[\^([^\]]+)\]/g, function (_, inlineContent, refId) {
      const token = `@@MPE${placeholders.length}@@`;
      let footnoteId = "";

      if (inlineContent) {
        footnoteId = `inline-${noteState.inlineNext}`;
        noteState.inlineNext += 1;
        noteMap[footnoteId] = inlineContent;
      } else {
        footnoteId = refId.trim();
      }

      placeholders.push(renderFootnoteReference(footnoteId, noteState));
      return token;
    });

    output = output.replace(/(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/gs, function (_, math) {
      const token = `@@MPE${placeholders.length}@@`;
      const source = math.trim();
      placeholders.push(`<span class="mpe-math-inline" data-math="${escapeHtml(source)}">${escapeHtml(source)}</span>`);
      return token;
    });

    output = escapeHtml(output);
    output = output.replace(/~~(.+?)~~/gs, "<del>$1</del>");
    output = output.replace(/\*\*(.+?)\*\*/gs, "<strong>$1</strong>");
    output = output.replace(/\*(.+?)\*/gs, "<em>$1</em>");

    if (preserveLineBreaks) {
      output = output.replace(/\n/g, "<br />");
    }

    placeholders.forEach(function (html, index) {
      output = output.replace(`@@MPE${index}@@`, html);
    });

    return output;
  }

  function renderMarkdown(markdown) {
    const sanitizedMarkdown = markdown.replace(/<!--[\s\S]*?-->/g, "");
    const lines = sanitizedMarkdown.replace(/\r\n?/g, "\n").split("\n");
    const footnotes = {};
    const contentLines = extractFootnoteDefinitions(lines, footnotes);
    const footnoteState = {
      nextNumber: 1,
      items: {},
      inlineNext: 1
    };
    const headingIds = {};
    let html = "";
    let paragraph = [];
    let listType = null;
    let listItems = [];
    let blockquote = [];
    let tableLines = [];
    let inCodeBlock = false;
    let inMathBlock = false;
    let codeLang = "text";
    let codeDiffLang = "";
    let codeFilename = "";
    let codeLines = [];
    let mathLines = [];
    let indentedCodeLines = [];

    function generateHeadingId(text) {
      const base = normalizeAnchorTarget(text);
      if (!Object.prototype.hasOwnProperty.call(headingIds, base)) {
        headingIds[base] = 0;
        return base;
      }
      headingIds[base] += 1;
      return `${base}-${headingIds[base]}`;
    }

    function consumeZennBlock(sourceLines, startIndex, colonCount, type, argument) {
      const content = [];
      const closingPattern = new RegExp(`^${":".repeat(colonCount)}\\s*$`);
      let endIndex = startIndex;

      for (let i = startIndex + 1; i < sourceLines.length; i += 1) {
        if (closingPattern.test(sourceLines[i])) {
          endIndex = i;
          break;
        }
        content.push(sourceLines[i]);
        endIndex = i;
      }

      return {
        type,
        argument: (argument || "").trim(),
        content: content.join("\n"),
        endIndex
      };
    }

    function stripRenderedWrapper(fragment) {
      return fragment.replace(/^<div class="mpe-rendered-content">/, "").replace(/<\/div>$/, "");
    }

    function renderZennBlock(type, argument, content) {
      const innerHtml = stripRenderedWrapper(renderMarkdown(content));

      if (type === "message") {
        const modifier = argument.trim() === "alert" ? " mpe-zenn-message-alert" : "";
        return `<div class="mpe-zenn-message${modifier}">${innerHtml}</div>`;
      }

      if (type === "details") {
        return `<details class="mpe-zenn-details"><summary>${escapeHtml(argument)}</summary>${innerHtml}</details>`;
      }

      return innerHtml;
    }

    function renderCardEmbed(url, modifierClass) {
      let label = url;
      try {
        label = new URL(url).host;
      } catch (error) {
        label = url;
      }
      const normalizedLabel = String(label).toLowerCase();
      const brandLogo = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(normalizedLabel)}&sz=256`;
      const brand = `<span class="mpe-embed-brand" aria-hidden="true"><img src="${escapeHtml(brandLogo)}" alt="" loading="lazy" decoding="async" /><span class="mpe-embed-brand-fallback">${escapeHtml(label)}</span></span>`;
      const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(normalizedLabel)}&sz=64`;
      return `<a class="mpe-embed-link ${modifierClass}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><span class="mpe-embed-main"><span class="mpe-embed-label">${escapeHtml(label)}</span><span class="mpe-embed-url">${escapeHtml(url)}</span><span class="mpe-embed-site"><span class="mpe-embed-site-icon" aria-hidden="true"><img src="${escapeHtml(faviconUrl)}" alt="" loading="lazy" decoding="async" /></span><span class="mpe-embed-site-name">${escapeHtml(label)}</span></span></span>${brand}</a>`;
    }

    function extractYouTubeVideoId(value) {
      const trimmed = (value || "").trim();
      if (/^[A-Za-z0-9_-]{6,}$/.test(trimmed) && !/^https?:\/\//.test(trimmed)) {
        return trimmed;
      }

      try {
        const url = new URL(trimmed);
        if (url.hostname.indexOf("youtu.be") !== -1) {
          return url.pathname.replace(/^\/+/, "");
        }
        if (url.searchParams.get("v")) {
          return url.searchParams.get("v");
        }
        const embedMatch = url.pathname.match(/\/embed\/([^/]+)/);
        return embedMatch ? embedMatch[1] : "";
      } catch (error) {
        return "";
      }
    }

    function renderYouTubeEmbed(value) {
      const videoId = extractYouTubeVideoId(value);
      if (!videoId) {
        return renderCardEmbed(value, "mpe-embed-card");
      }
      return `<div class="mpe-embed-youtube"><iframe src="https://www.youtube.com/embed/${escapeHtml(videoId)}" title="YouTube video" loading="lazy" allowfullscreen></iframe></div>`;
    }

    function renderTweetEmbed(url) {
      const match = String(url || "").match(/\/status\/(\d+)/);
      if (!match) {
        return renderCardEmbed(url, "mpe-embed-card");
      }
      return `<div class="mpe-embed-tweet" data-tweet-id="${escapeHtml(match[1])}" data-tweet-url="${escapeHtml(url)}"><a class="mpe-embed-link mpe-embed-tweet-fallback" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a></div>`;
    }

    function renderGistEmbed(url) {
      const match = String(url || "").match(/\/([a-f0-9]{8,})\/?$/i);
      if (!match) {
        return renderCardEmbed(url, "mpe-embed-card");
      }
      return `<div class="mpe-embed-gist" data-gist-id="${escapeHtml(match[1])}" data-gist-url="${escapeHtml(url)}"><a class="mpe-embed-link mpe-embed-gist-fallback" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a></div>`;
    }

    function isGitHubBlobUrl(url) {
      try {
        const parsed = new URL(url);
        const parts = parsed.pathname.split("/").filter(Boolean);
        return parts.length >= 5 && parts[2] === "blob";
      } catch (error) {
        return false;
      }
    }

    function renderEmbedDirective(type, value) {
      const normalizedType = (type || "").trim().toLowerCase();
      if (normalizedType === "youtube") {
        return renderYouTubeEmbed(value);
      }
      if (normalizedType === "tweet") {
        return renderTweetEmbed(value);
      }
      if (normalizedType === "gist") {
        return renderGistEmbed(value);
      }
      if (normalizedType === "card") {
        return renderCardEmbed(value, "mpe-embed-card");
      }
      return renderCardEmbed(value, "mpe-embed-card");
    }

    function renderEmbedUrl(url) {
      try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        if (host.indexOf("youtube.com") !== -1 || host.indexOf("youtu.be") !== -1) {
          return renderYouTubeEmbed(url);
        }
        if (host.indexOf("twitter.com") !== -1 || host.indexOf("x.com") !== -1) {
          return renderTweetEmbed(url);
        }
        if (host.indexOf("gist.github.com") !== -1) {
          return renderGistEmbed(url);
        }
        if (host.indexOf("github.com") !== -1 && isGitHubBlobUrl(url)) {
          return `<div class="mpe-embed-github" data-github-url="${escapeHtml(url)}"><a class="mpe-embed-link mpe-embed-github-fallback" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><span class="mpe-embed-label">${escapeHtml(url)}</span></a></div>`;
        }
      } catch (error) {
        return renderCardEmbed(url, "mpe-embed-card");
      }

      return renderCardEmbed(url, "mpe-embed-card");
    }

    function extractFootnoteDefinitions(sourceLines, target) {
      const filtered = [];

      for (let i = 0; i < sourceLines.length; i += 1) {
        const line = sourceLines[i];
        const match = line.match(/^\[\^([^\]]+)\]:\s*(.*)$/);
        if (!match) {
          filtered.push(line);
          continue;
        }

        const id = match[1].trim();
        const content = [match[2]];
        while (i + 1 < sourceLines.length) {
          const continuation = sourceLines[i + 1].match(/^(?:\s{2,}|\t)(.*)$/);
          if (!continuation) {
            break;
          }
          i += 1;
          content.push(continuation[1]);
        }
        target[id] = content.join("\n");
      }

      return filtered;
    }

    function renderFootnotes() {
      const items = Object.keys(footnoteState.items).map(function (footnoteId) {
        return {
          footnoteId,
          meta: footnoteState.items[footnoteId]
        };
      }).sort(function (left, right) {
        return left.meta.number - right.meta.number;
      });

      if (!items.length) {
        return "";
      }

      let footnoteHtml = '<section class="mpe-footnotes"><hr /><ol>';
      items.forEach(function (item) {
        const footnoteId = item.footnoteId;
        const meta = item.meta;
        const backlinks = [];
        for (let i = 1; i <= meta.references; i += 1) {
          backlinks.push(`<a class="mpe-footnote-backref" href="#${getFootnoteReferenceId(footnoteId, i)}" aria-label="Back to reference">&#8617;</a>`);
        }
        footnoteHtml += `<li id="${getFootnoteItemId(footnoteId)}">${renderInline(footnotes[footnoteId] || "", true, {}, { nextNumber: 1, items: {}, inlineNext: 1 })} ${backlinks.join(" ")}</li>`;
      });
      footnoteHtml += "</ol></section>";
      return footnoteHtml;
    }

    function parseFenceInfo(info) {
      const trimmed = info.trim();
      if (!trimmed) {
        return { lang: "text", diffLang: "", filename: "" };
      }

      const segments = trimmed.split(/\s+/).filter(Boolean);
      if (segments[0] === "diff") {
        const diffTarget = segments[1] || "";
        const separatorIndex = diffTarget.indexOf(":");
        if (separatorIndex === -1) {
          return { lang: "diff", diffLang: (diffTarget || "text").toLowerCase(), filename: "" };
        }

        return {
          lang: "diff",
          diffLang: (diffTarget.slice(0, separatorIndex).trim() || "text").toLowerCase(),
          filename: diffTarget.slice(separatorIndex + 1).trim()
        };
      }

      const separatorIndex = trimmed.indexOf(":");
      if (separatorIndex === -1) {
        return { lang: trimmed.toLowerCase(), diffLang: "", filename: "" };
      }

      return {
        lang: (trimmed.slice(0, separatorIndex).trim() || "text").toLowerCase(),
        diffLang: "",
        filename: trimmed.slice(separatorIndex + 1).trim()
      };
    }

    function renderCodeBlock(code, lang, filename, diffLang) {
      const isDiff = lang === "diff";
      const effectiveLang = isDiff && diffLang ? diffLang : (lang || "text");
      const safeLang = escapeHtml(effectiveLang);
      const header = filename ? `<div class="mpe-code-header">${escapeHtml(filename)}</div>` : "";
      const shellClass = filename ? "mpe-code-shell mpe-code-shell-has-header" : "mpe-code-shell";
      const diffModeAttr = isDiff ? ' data-code-mode="diff"' : "";
      const diffLangAttr = isDiff && diffLang ? ` data-code-diff-lang="${escapeHtml(diffLang)}"` : "";
      return `<div class="${shellClass}" data-code-lang="${safeLang}"${diffModeAttr}${diffLangAttr}>${header}<div class="mpe-code-block"><div class="mpe-code-body"><button type="button" class="mpe-code-copy" aria-label="Copy code">Copy</button><pre class="mpe-code-pre"><code class="language-${safeLang}">${escapeHtml(code)}</code></pre></div></div></div>`;
    }

    function renderMathBlock(math) {
      const source = math.trim();
      return `<div class="mpe-math-block" data-math="${escapeHtml(source)}">${escapeHtml(source)}</div>`;
    }

    function flushParagraph() {
      if (!paragraph.length) {
        return;
      }
      html += `<p>${renderInline(paragraph.join("\n"), true, footnotes, footnoteState)}</p>`;
      paragraph = [];
    }

    function flushList() {
      if (!listType || !listItems.length) {
        listType = null;
        listItems = [];
        return;
      }
      html += `<${listType}>${listItems.map((item) => `<li>${renderInline(item, false, footnotes, footnoteState)}</li>`).join("")}</${listType}>`;
      listType = null;
      listItems = [];
    }

    function flushBlockquote() {
      if (!blockquote.length) {
        return;
      }
      html += `<blockquote><p>${blockquote.map((line) => renderInline(line, false, footnotes, footnoteState)).join("<br />")}</p></blockquote>`;
      blockquote = [];
    }

    function isTableLine(line) {
      return line.indexOf("|") !== -1;
    }

    function splitTableRow(line) {
      return line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim())
        .filter((cell) => cell !== "");
    }

    function isTableSeparator(line) {
      const cells = splitTableRow(line);
      if (!cells.length) {
        return false;
      }
      return cells.every((cell) => /^:?-+:?$/.test(cell));
    }

    function flushTable() {
      if (tableLines.length < 2 || !isTableSeparator(tableLines[1])) {
        if (tableLines.length) {
          html += `<p>${renderInline(tableLines.join("\n"), true, footnotes, footnoteState)}</p>`;
        }
        tableLines = [];
        return;
      }

      const headers = splitTableRow(tableLines[0]);
      const rows = tableLines.slice(2);
      html += "<table><thead><tr>";
      headers.forEach((header) => {
        html += `<th>${renderInline(header, false, footnotes, footnoteState)}</th>`;
      });
      html += "</tr></thead><tbody>";
      rows.forEach((row) => {
        const cells = splitTableRow(row);
        if (!cells.length) {
          return;
        }
        html += "<tr>";
        cells.forEach((cell) => {
          html += `<td>${renderInline(cell, false, footnotes, footnoteState)}</td>`;
        });
        html += "</tr>";
      });
      html += "</tbody></table>";
      tableLines = [];
    }

    for (let index = 0; index < contentLines.length; index += 1) {
      const line = contentLines[index];
      if (inCodeBlock) {
        if (/^```(.*)$/.test(line)) {
          html += renderCodeBlock(codeLines.join("\n"), codeLang, codeFilename, codeDiffLang);
          codeLines = [];
          codeLang = "text";
          codeDiffLang = "";
          codeFilename = "";
          inCodeBlock = false;
        } else {
          codeLines.push(line);
        }
        continue;
      }

      if (indentedCodeLines.length) {
        const indentedCodeMatch = line.match(/^(?:\t| {4})(.*)$/);
        if (indentedCodeMatch) {
          indentedCodeLines.push(indentedCodeMatch[1]);
          continue;
        }

        if (!line.trim()) {
          indentedCodeLines.push("");
          continue;
        }

        html += renderCodeBlock(indentedCodeLines.join("\n"), "text", "", "");
        indentedCodeLines = [];
      }

      if (inMathBlock) {
        if (line.trim() === "$$") {
          html += renderMathBlock(mathLines.join("\n"));
          mathLines = [];
          inMathBlock = false;
        } else {
          mathLines.push(line);
        }
        continue;
      }

      const zennBlockMatch = line.match(/^(:{3,})(message|details)(?:\s+(.*))?$/);
      if (zennBlockMatch) {
        flushParagraph();
        flushList();
        flushBlockquote();
        flushTable();
        const zennBlock = consumeZennBlock(contentLines, index, zennBlockMatch[1].length, zennBlockMatch[2], zennBlockMatch[3] || "");
        index = zennBlock.endIndex;
        html += renderZennBlock(zennBlock.type, zennBlock.argument, zennBlock.content);
        continue;
      }

      const embedDirectiveMatch = line.trim().match(/^@\[([a-z]+)\]\((https?:\/\/[^\s)]+|[A-Za-z0-9_-]+)\)$/);
      if (embedDirectiveMatch) {
        flushParagraph();
        flushList();
        flushBlockquote();
        flushTable();
        html += renderEmbedDirective(embedDirectiveMatch[1], embedDirectiveMatch[2]);
        continue;
      }

      if (/^https?:\/\/\S+$/.test(line.trim())) {
        flushParagraph();
        flushList();
        flushBlockquote();
        flushTable();
        html += renderEmbedUrl(line.trim());
        continue;
      }

      const codeFenceMatch = line.match(/^```(.*)$/);
      if (codeFenceMatch) {
        flushParagraph();
        flushList();
        flushBlockquote();
        flushTable();
        const info = parseFenceInfo(codeFenceMatch[1]);
        codeLang = info.lang;
        codeDiffLang = info.diffLang;
        codeFilename = info.filename;
        inCodeBlock = true;
        continue;
      }

      const indentedCodeMatch = line.match(/^(?:\t| {4})(.*)$/);
      if (indentedCodeMatch) {
        flushParagraph();
        flushList();
        flushBlockquote();
        flushTable();
        indentedCodeLines.push(indentedCodeMatch[1]);
        continue;
      }

      if (line.trim() === "$$") {
        flushParagraph();
        flushList();
        flushBlockquote();
        flushTable();
        inMathBlock = true;
        continue;
      }

      if (!line.trim()) {
        flushParagraph();
        flushList();
        flushBlockquote();
        flushTable();
        continue;
      }

      const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        flushParagraph();
        flushList();
        flushBlockquote();
        flushTable();
        const level = headingMatch[1].length;
        const headingId = generateHeadingId(headingMatch[2]);
        html += `<h${level} id="${escapeHtml(headingId)}">${renderInline(headingMatch[2], false, footnotes, footnoteState)}</h${level}>`;
        continue;
      }

      const quoteMatch = line.match(/^>\s?(.*)$/);
      if (quoteMatch) {
        flushParagraph();
        flushList();
        flushTable();
        blockquote.push(quoteMatch[1]);
        continue;
      }

      if (isTableLine(line)) {
        flushParagraph();
        flushList();
        flushBlockquote();
        tableLines.push(line);
        continue;
      }

      flushTable();

      const unorderedMatch = line.match(/^[-*+]\s+(.*)$/);
      if (unorderedMatch) {
        flushParagraph();
        flushBlockquote();
        if (listType !== "ul") {
          flushList();
          listType = "ul";
        }
        listItems.push(unorderedMatch[1]);
        continue;
      }

      const orderedMatch = line.match(/^\d+\.\s+(.*)$/);
      if (orderedMatch) {
        flushParagraph();
        flushBlockquote();
        if (listType !== "ol") {
          flushList();
          listType = "ol";
        }
        listItems.push(orderedMatch[1]);
        continue;
      }

      if (/^---+$/.test(line.trim())) {
        flushParagraph();
        flushList();
        flushBlockquote();
        flushTable();
        html += "<hr />";
        continue;
      }

      paragraph.push(line);
    }

    if (inCodeBlock) {
      html += renderCodeBlock(codeLines.join("\n"), codeLang, codeFilename, codeDiffLang);
    }

    if (indentedCodeLines.length) {
      html += renderCodeBlock(indentedCodeLines.join("\n"), "text", "", "");
    }

    if (inMathBlock) {
      html += renderMathBlock(mathLines.join("\n"));
    }

    flushParagraph();
    flushList();
    flushBlockquote();
    flushTable();
    html += renderFootnotes();

    return html;
  }

  function setStatus(message, isError) {
    const statusNode = document.getElementById("mpe-status");
    if (!statusNode) {
      return;
    }
    statusNode.textContent = message || "";
    statusNode.classList.toggle("is-error", Boolean(isError));
  }

  function getEditorState() {
    const title = document.getElementById("mpe-post-title");
    const status = document.getElementById("mpe-post-status");
    const editor = document.getElementById("mpe-markdown-editor");
    const postId = document.getElementById("mpe-post-id");
    const featuredImageId = document.getElementById("mpe-featured-image-id");
    const tags = document.getElementById("mpe-post-tags");
    const categories = Array.from(document.querySelectorAll(".mpe-category-checkbox:checked")).map(function (checkbox) {
      return checkbox.value;
    }).sort();

    return {
      title,
      status,
      editor,
      postId,
      featuredImageId,
      tags,
      snapshot: JSON.stringify({
        title: title ? title.value : "",
        status: status ? status.value : "",
        markdown: editor ? editor.value : "",
        postId: postId ? postId.value : "0",
        featuredImageId: featuredImageId ? featuredImageId.value : "0",
        tags: tags ? tags.value : "",
        categories
      })
    };
  }

  function markDirty() {
    const state = getEditorState();
    isDirty = state.snapshot !== lastSavedSnapshot;
    updateSaveButtonState(isDirty ? "dirty" : "saved");
  }

  function getPreviewUrl() {
    const postId = document.getElementById("mpe-post-id");
    if (!postId || !postId.value || postId.value === "0") {
      return "";
    }

    return `${MPE_Admin.previewBaseUrl}${encodeURIComponent(postId.value)}`;
  }

  function updatePreview() {
    const editor = document.getElementById("mpe-markdown-editor");
    const preview = document.getElementById("mpe-preview");
    if (!editor || !preview) {
      return;
    }

    preview.innerHTML = editor.value.trim()
      ? renderMarkdown(editor.value)
      : `<p class="mpe-empty-preview">${escapeHtml(MPE_Admin.previewFallback)}</p>`;

    if (window.MPECodeHighlighter) {
      window.MPECodeHighlighter.highlightWithin(preview);
    }
    if (window.MPEMathRenderer) {
      window.MPEMathRenderer.renderWithin(preview);
    }
    if (window.MPEEmbedRenderer) {
      window.MPEEmbedRenderer.renderWithin(preview);
    }
  }

  function handlePreviewAnchorClick(event) {
    const link = event.target.closest('a[href^="#"]');
    if (!link) {
      return;
    }

    const href = link.getAttribute("href") || "";
    if (href.length <= 1) {
      return;
    }

    const targetId = decodeURIComponent(href.slice(1));
    const target = document.getElementById(targetId);
    if (!target) {
      return;
    }

    event.preventDefault();
    target.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  function insertAtCursor(textarea, text) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
    textarea.selectionStart = textarea.selectionEnd = start + text.length;
    textarea.focus();
    updatePreview();
    markDirty();
  }

  function updateFeaturedImageUi(image) {
    const imageIdInput = document.getElementById("mpe-featured-image-id");
    const preview = document.getElementById("mpe-featured-image-preview");
    const placeholder = document.getElementById("mpe-featured-image-placeholder");
    const removeButton = document.getElementById("mpe-featured-image-remove");
    if (!imageIdInput || !preview || !removeButton) {
      return;
    }

    if (image && image.id) {
      imageIdInput.value = String(image.id);
      preview.src = image.url || "";
      preview.style.display = image.url ? "block" : "none";
      removeButton.style.display = "";
      if (placeholder) {
        placeholder.style.display = "none";
      }
    } else {
      imageIdInput.value = "0";
      preview.src = "";
      preview.style.display = "none";
      removeButton.style.display = "none";
      if (placeholder) {
        placeholder.style.display = "grid";
      }
    }
  }

  function openFeaturedImagePicker() {
    if (!window.wp || !window.wp.media) {
      setStatus("WordPress media library is unavailable on this page.", true);
      return;
    }

    if (!featuredImageFrame) {
      featuredImageFrame = window.wp.media({
        title: MPE_Admin.featuredImageTitle,
        button: { text: MPE_Admin.featuredImageButton },
        multiple: false,
        library: { type: "image" }
      });

      featuredImageFrame.on("select", function () {
        const attachment = featuredImageFrame.state().get("selection").first();
        if (!attachment) {
          return;
        }
        const image = attachment.toJSON();
        updateFeaturedImageUi({
          id: image.id,
          url: (image.sizes && image.sizes.medium && image.sizes.medium.url) || image.url || ""
        });
        markDirty();
      });
    }

    featuredImageFrame.open();
  }

  async function uploadClipboardImage(file) {
    const formData = new FormData();
    formData.append("action", "mpe_upload_image");
    formData.append("nonce", MPE_Admin.nonce);
    formData.append("image", file, file.name || "pasted-image.png");

    const response = await fetch(MPE_Admin.ajaxUrl, {
      method: "POST",
      body: formData,
      credentials: "same-origin"
    });

    const payload = await response.json();
    if (!response.ok || !payload.success) {
      throw new Error((payload && payload.data && payload.data.message) || MPE_Admin.uploadFailedText);
    }

    return payload.data;
  }

  async function handlePaste(event) {
    const editor = event.currentTarget;
    const items = Array.from((event.clipboardData && event.clipboardData.items) || []);
    const imageItem = items.find((item) => item.type && item.type.indexOf("image/") === 0);

    if (!imageItem) {
      return;
    }

    event.preventDefault();
    setStatus(MPE_Admin.uploadingText, false);

    try {
      const file = imageItem.getAsFile();
      const result = await uploadClipboardImage(file);
      insertAtCursor(editor, result.markdown);
      setStatus(result.message, false);
    } catch (error) {
      setStatus(error.message || MPE_Admin.uploadFailedText, true);
    }
  }

  async function savePost(options) {
    const settings = options || {};
    const state = getEditorState();
    const preview = document.getElementById("mpe-preview");

    if (!state.title || !state.status || !state.editor || !state.postId || !preview) {
      return null;
    }

    if (isSaving) {
      return null;
    }

    if (settings.onlyIfDirty && !isDirty) {
      return null;
    }

    isSaving = true;
    updateSaveButtonState("saving");
    setStatus(settings.isAutosave ? MPE_Admin.autosavingText : MPE_Admin.savingText, false);

    const formData = new FormData();
    formData.append("action", "mpe_save_post");
    formData.append("nonce", MPE_Admin.nonce);
    formData.append("title", state.title.value);
    formData.append("status", state.status.value);
    formData.append("markdown", state.editor.value);
    formData.append("post_id", state.postId.value || "0");
    formData.append("featured_image_id", state.featuredImageId ? state.featuredImageId.value : "0");
    if (state.tags) {
      formData.append("tags", state.tags.value);
    }
    document.querySelectorAll(".mpe-category-checkbox:checked").forEach(function (checkbox) {
      formData.append("categories[]", checkbox.value);
    });

    try {
      const response = await fetch(MPE_Admin.ajaxUrl, {
        method: "POST",
        body: formData,
        credentials: "same-origin"
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error((payload && payload.data && payload.data.message) || MPE_Admin.saveFailedText);
      }

      state.postId.value = String(payload.data.postId);
      window.history.replaceState({}, "", payload.data.editUrl);
      updateFeaturedImageUi({
        id: payload.data.featuredImageId || 0,
        url: payload.data.featuredImageUrl || ""
      });
      const tagField = document.getElementById("mpe-post-tags");
      if (tagField && Array.isArray(payload.data.tags)) {
        tagField.value = payload.data.tags.join(", ");
      }
      if (Array.isArray(payload.data.categories)) {
        const selectedCategories = payload.data.categories.map(String);
        document.querySelectorAll(".mpe-category-checkbox").forEach(function (checkbox) {
          checkbox.checked = selectedCategories.indexOf(checkbox.value) !== -1;
        });
      }
      preview.innerHTML = payload.data.html;
      if (window.MPECodeHighlighter) {
        window.MPECodeHighlighter.highlightWithin(preview);
      }
      if (window.MPEMathRenderer) {
        window.MPEMathRenderer.renderWithin(preview);
      }
      if (window.MPEEmbedRenderer) {
        window.MPEEmbedRenderer.renderWithin(preview);
      }
      lastSavedSnapshot = getEditorState().snapshot;
      isDirty = false;
      updateSaveButtonState("saved");
      setStatus(settings.isAutosave ? MPE_Admin.autosavedText : payload.data.message, false);
      return payload.data;
    } catch (error) {
      updateSaveButtonState(isDirty ? "dirty" : (stateHasSavedPost() ? "saved" : "idle"));
      setStatus(error.message || MPE_Admin.saveFailedText, true);
      return null;
    } finally {
      isSaving = false;
    }
  }

  async function openPreviewPage() {
    let previewUrl = getPreviewUrl();

    if (!previewUrl || isDirty) {
      const result = await savePost({ onlyIfDirty: false, isAutosave: false });
      if (!result) {
        if (!previewUrl) {
          setStatus(MPE_Admin.previewUnavailableText, true);
        }
        return;
      }
      previewUrl = getPreviewUrl();
    }

    if (!previewUrl) {
      setStatus(MPE_Admin.previewUnavailableText, true);
      return;
    }

    window.open(previewUrl, "_blank", "noopener");
  }

  function scheduleAutosave() {
    if (autosaveTimer) {
      window.clearInterval(autosaveTimer);
    }

    autosaveTimer = window.setInterval(function () {
      savePost({ onlyIfDirty: true, isAutosave: true });
    }, 30000);
  }

  document.addEventListener("DOMContentLoaded", function () {
    const editor = document.getElementById("mpe-markdown-editor");
    const saveButton = document.getElementById("mpe-save-post");
    const previewButton = document.getElementById("mpe-preview-page");
    const title = document.getElementById("mpe-post-title");
    const status = document.getElementById("mpe-post-status");
    const tags = document.getElementById("mpe-post-tags");
    const featuredImageSelect = document.getElementById("mpe-featured-image-select");
    const featuredImageRemove = document.getElementById("mpe-featured-image-remove");
    const categoryCheckboxes = document.querySelectorAll(".mpe-category-checkbox");

    if (!editor || !saveButton || !previewButton || !title || !status || !tags || !featuredImageSelect || !featuredImageRemove) {
      return;
    }

    lastSavedSnapshot = getEditorState().snapshot;
    updatePreview();
    scheduleAutosave();
    updateSaveButtonState(stateHasSavedPost() ? "saved" : "idle");

    editor.addEventListener("input", function () {
      updatePreview();
      markDirty();
    });
    editor.addEventListener("paste", handlePaste);
    document.addEventListener("click", handlePreviewAnchorClick);
    title.addEventListener("input", markDirty);
    status.addEventListener("change", markDirty);
    tags.addEventListener("input", markDirty);
    featuredImageSelect.addEventListener("click", openFeaturedImagePicker);
    featuredImageRemove.addEventListener("click", function () {
      updateFeaturedImageUi(null);
      markDirty();
    });
    categoryCheckboxes.forEach(function (checkbox) {
      checkbox.addEventListener("change", markDirty);
    });
    saveButton.addEventListener("click", function () {
      savePost({ onlyIfDirty: false, isAutosave: false });
    });
    previewButton.addEventListener("click", openPreviewPage);

    document.addEventListener("keydown", function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        savePost({ onlyIfDirty: false, isAutosave: false });
      }
    });
  });
})();
