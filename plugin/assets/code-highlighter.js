(function () {
  let shikiShellTemplate = null;

  function ensureCopyButton(body) {
    if (!body) {
      return null;
    }

    let copyButton = body.querySelector(".mpe-code-copy");
    if (copyButton) {
      return copyButton;
    }

    copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "mpe-code-copy";
    copyButton.setAttribute("aria-label", "Copy code");
    copyButton.textContent = "Copy";
    body.insertAdjacentElement("afterbegin", copyButton);
    return copyButton;
  }

  function setCopyButtonState(button, copied) {
    if (!button) {
      return;
    }

    button.textContent = copied ? "Copied" : "Copy";
  }

  async function copyBlockCode(block) {
    const codeNode = block.querySelector(".mpe-code-body code");
    const copyButton = block.querySelector(".mpe-code-copy");
    const rawCode = block.dataset.rawCode || "";
    if ((!codeNode && !rawCode) || !copyButton || !navigator.clipboard) {
      return;
    }

    try {
      await navigator.clipboard.writeText(rawCode || codeNode.textContent || "");
      setCopyButtonState(copyButton, true);
      window.setTimeout(function () {
        setCopyButtonState(copyButton, false);
      }, 1500);
    } catch (error) {
      setCopyButtonState(copyButton, false);
    }
  }

  function escapeHtml(value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getDiffLineType(marker) {
    if (marker === "+") {
      return "add";
    }

    if (marker === "-") {
      return "remove";
    }

    if (marker === ">" || marker === "<") {
      return "meta";
    }

    if (marker === " ") {
      return "context";
    }

    return "";
  }

  function extractPreAttributes(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const pre = doc.querySelector("pre.shiki");
    return {
      className: pre ? pre.className : "shiki github-dark",
      style: pre ? pre.getAttribute("style") || "" : ""
    };
  }

  function extractHighlightedLineHtml(html, fallbackLine) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const line = doc.querySelector("pre.shiki code .line");
    return line ? line.innerHTML : escapeHtml(fallbackLine);
  }

  async function codeToHtml(code, lang) {
    try {
      return await window.MPEShiki.codeToHtml(code, {
        lang,
        theme: "github-dark"
      });
    } catch (error) {
      return window.MPEShiki.codeToHtml(code, {
        lang: "text",
        theme: "github-dark"
      });
    }
  }

  async function getShikiShellTemplate() {
    if (shikiShellTemplate) {
      return shikiShellTemplate;
    }

    const html = await codeToHtml(" ", "text");
    shikiShellTemplate = extractPreAttributes(html);
    return shikiShellTemplate;
  }

  async function renderDiffHtml(code, lang) {
    const shell = await getShikiShellTemplate();
    const lines = code.split("\n");
    const renderedLines = await Promise.all(lines.map(async function (line) {
      const marker = line.charAt(0);
      const type = getDiffLineType(marker);

      if (!type) {
        return `<span class="line mpe-diff-line"><span class="mpe-diff-content">${escapeHtml(line)}</span></span>`;
      }

      const rawContent = line.slice(1);
      const displayContent = rawContent.startsWith(" ") ? rawContent.slice(1) : rawContent;
      const highlighted = await codeToHtml(displayContent, lang || "text");
      const lineHtml = extractHighlightedLineHtml(highlighted, displayContent);

      return `<span class="line mpe-diff-line mpe-diff-${type}"><span class="mpe-diff-marker">${escapeHtml(marker)}</span><span class="mpe-diff-content">${lineHtml}</span></span>`;
    }));

    const styleAttr = shell.style ? ` style="${escapeHtml(shell.style)}"` : "";
    return `<pre class="${escapeHtml(shell.className)}"${styleAttr} tabindex="0"><code>${renderedLines.join("\n")}</code></pre>`;
  }

  async function highlightBlock(block) {
    const body = block.querySelector(".mpe-code-body");
    const codeNode = body ? body.querySelector("code") : null;
    const copyButton = ensureCopyButton(body);
    if (!body || !codeNode || body.dataset.mpeHighlighted === "1") {
      return;
    }

    if (!window.MPEShiki || typeof window.MPEShiki.codeToHtml !== "function") {
      body.dataset.mpeHighlighted = "0";
      return;
    }

    const code = codeNode.textContent || "";
    const lang = block.dataset.codeLang || "text";
    const mode = block.dataset.codeMode || "";
    block.dataset.rawCode = code;

    try {
      let html = "";

      if (mode === "diff") {
        html = await renderDiffHtml(code, lang);
      } else {
        html = await codeToHtml(code, lang);
      }

      body.innerHTML = html;
      if (copyButton) {
        body.insertAdjacentElement("afterbegin", copyButton);
      }
      body.dataset.mpeHighlighted = "1";
    } catch (error) {
      body.dataset.mpeHighlighted = "0";
    }
  }

  async function highlightWithin(root) {
    const scope = root || document;
    const blocks = scope.querySelectorAll(".mpe-code-shell");
    await Promise.all(Array.from(blocks).map(highlightBlock));
  }

  window.MPECodeHighlighter = {
    highlightWithin
  };

  document.addEventListener("DOMContentLoaded", function () {
    highlightWithin(document);
  });

  document.addEventListener("click", function (event) {
    const copyButton = event.target.closest(".mpe-code-copy");
    if (!copyButton) {
      return;
    }

    const block = copyButton.closest(".mpe-code-shell");
    if (!block) {
      return;
    }

    copyBlockCode(block);
  });
})();
