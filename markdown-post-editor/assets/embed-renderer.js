(function () {
  let xWidgetsPromise = null;

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function loadXWidgets() {
    if (window.twttr && window.twttr.widgets && typeof window.twttr.widgets.createTweet === "function") {
      return Promise.resolve(window.twttr);
    }

    if (xWidgetsPromise) {
      return xWidgetsPromise;
    }

    xWidgetsPromise = new Promise(function (resolve, reject) {
      const existing = document.querySelector('script[data-mpe-x-widgets="1"]');
      if (existing) {
        existing.addEventListener("load", function () {
          resolve(window.twttr);
        }, { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }

      const script = document.createElement("script");
      script.async = true;
      script.defer = true;
      script.src = "https://platform.twitter.com/widgets.js";
      script.dataset.mpeXWidgets = "1";
      script.addEventListener("load", function () {
        resolve(window.twttr);
      }, { once: true });
      script.addEventListener("error", reject, { once: true });
      document.head.appendChild(script);
    });

    return xWidgetsPromise;
  }

  function parseLineRange(anchor) {
    const match = String(anchor || "").match(/^L(\d+)(?:-L?(\d+))?$/i);
    if (!match) {
      return null;
    }

    const start = parseInt(match[1], 10);
    const end = parseInt(match[2] || match[1], 10);
    return {
      start,
      end
    };
  }

  function parseGitHubUrl(url) {
    try {
      const parsed = new URL(url);
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length < 5 || parts[2] !== "blob") {
        return null;
      }

      return {
        owner: parts[0],
        repo: parts[1],
        ref: parts[3],
        path: parts.slice(4).join("/"),
        anchor: parsed.hash.replace(/^#/, ""),
        rawUrl: `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${parts[3]}/${parts.slice(4).join("/")}`,
        originalUrl: url
      };
    } catch (error) {
      return null;
    }
  }

  function buildGitHubHtml(payload, source) {
    const range = parseLineRange(payload.anchor);
    const lines = String(source || "").replace(/\r\n?/g, "\n").split("\n");
    const start = range ? Math.max(1, range.start) : 1;
    const end = range ? Math.min(lines.length, range.end) : Math.min(lines.length, 12);
    const visible = lines.slice(start - 1, end);
    const subtitle = range ? `Lines ${start} to ${end} in ${payload.ref}` : payload.ref;
    const body = visible.map(function (line, index) {
      const lineNumber = start + index;
      return `<div class="mpe-github-line"><span class="mpe-github-line-no">${lineNumber}</span><span class="mpe-github-line-code">${escapeHtml(line)}</span></div>`;
    }).join("");

    return `<a class="mpe-github-header" href="${escapeHtml(payload.originalUrl)}" target="_blank" rel="noopener noreferrer"><span class="mpe-github-mark" aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false"><path fill="currentColor" d="M8 0C3.58 0 0 3.67 0 8.2c0 3.62 2.29 6.69 5.47 7.78.4.08.55-.18.55-.4 0-.2-.01-.87-.01-1.58-2.01.38-2.53-.5-2.69-.96-.09-.24-.48-.96-.82-1.16-.28-.15-.68-.52-.01-.53.63-.01 1.08.59 1.23.84.72 1.25 1.87.9 2.33.69.07-.54.28-.9.5-1.1-1.78-.21-3.64-.92-3.64-4.09 0-.9.31-1.64.82-2.22-.08-.21-.36-1.05.08-2.19 0 0 .67-.22 2.2.85A7.42 7.42 0 0 1 8 3.8c.68 0 1.36.09 2 .26 1.53-1.07 2.2-.85 2.2-.85.44 1.14.16 1.98.08 2.19.51.58.82 1.31.82 2.22 0 3.18-1.87 3.88-3.65 4.09.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.19 0 .22.15.49.55.4A8.24 8.24 0 0 0 16 8.2C16 3.67 12.42 0 8 0Z"></path></svg></span><span class="mpe-github-meta"><span class="mpe-github-title">${escapeHtml(`${payload.owner}/${payload.repo}/${payload.path}`)}</span><span class="mpe-github-subtitle">${escapeHtml(subtitle)}</span></span></a><div class="mpe-github-body">${body}</div>`;
  }

  async function renderGitHubEmbed(node) {
    if (!node || node.dataset.mpeGithubRendered === "1") {
      return;
    }

    const url = node.dataset.githubUrl || "";
    const payload = parseGitHubUrl(url);
    if (!payload) {
      node.dataset.mpeGithubRendered = "0";
      return;
    }

    try {
      const response = await fetch(payload.rawUrl, { credentials: "omit" });
      if (!response.ok) {
        throw new Error("GitHub fetch failed");
      }
      const source = await response.text();
      node.innerHTML = buildGitHubHtml(payload, source);
      node.dataset.mpeGithubRendered = "1";
    } catch (error) {
      node.dataset.mpeGithubRendered = "0";
    }
  }

  async function renderTweetEmbed(node) {
    if (!node || node.dataset.mpeTweetRendered === "1") {
      return;
    }

    const tweetId = node.dataset.tweetId || "";
    if (!tweetId) {
      node.dataset.mpeTweetRendered = "0";
      return;
    }

    try {
      const twttr = await loadXWidgets();
      if (!twttr || !twttr.widgets || typeof twttr.widgets.createTweet !== "function") {
        throw new Error("X widgets unavailable");
      }

      node.innerHTML = "";
      await twttr.widgets.createTweet(tweetId, node, {
        dnt: true,
        align: "center"
      });
      node.dataset.mpeTweetRendered = "1";
    } catch (error) {
      node.dataset.mpeTweetRendered = "0";
    }
  }

  function buildGistHtml(gist, originalUrl) {
    const files = gist && gist.files ? Object.values(gist.files) : [];
    if (!files.length) {
      throw new Error("Gist has no files");
    }

    const file = files[0];
    const content = String(file.content || "").replace(/\r\n?/g, "\n").split("\n");
    const visible = content.slice(0, 12);
    const body = visible.map(function (line, index) {
      return `<div class="mpe-gist-line"><span class="mpe-gist-line-no">${index + 1}</span><span class="mpe-gist-line-code">${escapeHtml(line)}</span></div>`;
    }).join("");
    const description = gist.description || file.filename || "Gist";
    const rawUrl = file.raw_url || originalUrl;

    return `<div class="mpe-gist-body">${body}</div><div class="mpe-gist-footer"><span class="mpe-gist-footer-text">${escapeHtml(description)}</span><a class="mpe-gist-raw-link" href="${escapeHtml(rawUrl)}" target="_blank" rel="noopener noreferrer">view raw</a></div>`;
  }

  async function renderGistEmbed(node) {
    if (!node || node.dataset.mpeGistRendered === "1") {
      return;
    }

    const gistId = node.dataset.gistId || "";
    const gistUrl = node.dataset.gistUrl || "";
    if (!gistId) {
      node.dataset.mpeGistRendered = "0";
      return;
    }

    try {
      const response = await fetch(`https://api.github.com/gists/${encodeURIComponent(gistId)}`, { credentials: "omit" });
      if (!response.ok) {
        throw new Error("Gist fetch failed");
      }
      const gist = await response.json();
      node.innerHTML = buildGistHtml(gist, gistUrl);
      node.dataset.mpeGistRendered = "1";
    } catch (error) {
      node.dataset.mpeGistRendered = "0";
    }
  }

  async function renderWithin(root) {
    const scope = root || document;
    const githubNodes = scope.querySelectorAll(".mpe-embed-github[data-github-url]");
    const gistNodes = scope.querySelectorAll(".mpe-embed-gist[data-gist-id]");
    const tweetNodes = scope.querySelectorAll(".mpe-embed-tweet[data-tweet-id]");
    await Promise.all(Array.from(githubNodes).map(renderGitHubEmbed));
    await Promise.all(Array.from(gistNodes).map(renderGistEmbed));
    await Promise.all(Array.from(tweetNodes).map(renderTweetEmbed));
  }

  window.MPEEmbedRenderer = {
    renderWithin
  };

  document.addEventListener("DOMContentLoaded", function () {
    renderWithin(document);
  });
})();
