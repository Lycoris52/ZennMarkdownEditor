(function () {
  let katexCssLoader = null;
  let katexScriptLoader = null;

  function getRuntimeConfig() {
    return window.MPE_Assets || {};
  }

  function loadStylesheet(url) {
    return new Promise(function (resolve, reject) {
      const existing = document.querySelector(`link[data-mpe-katex-css="${url}"]`);
      if (existing) {
        if (existing.dataset.mpeLoaded === "1") {
          resolve();
          return;
        }

        existing.addEventListener("load", function onLoad() {
          existing.dataset.mpeLoaded = "1";
          resolve();
        }, { once: true });
        existing.addEventListener("error", function onError() {
          reject(new Error("KaTeX stylesheet failed to load."));
        }, { once: true });
        return;
      }

      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = url;
      link.dataset.mpeKatexCss = url;
      link.addEventListener("load", function () {
        link.dataset.mpeLoaded = "1";
        resolve();
      }, { once: true });
      link.addEventListener("error", function () {
        reject(new Error("KaTeX stylesheet failed to load."));
      }, { once: true });
      document.head.appendChild(link);
    });
  }

  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      if (window.katex && typeof window.katex.render === "function") {
        resolve(window.katex);
        return;
      }

      const existing = document.querySelector(`script[data-mpe-katex-js="${url}"]`);
      if (existing) {
        existing.addEventListener("load", function () {
          resolve(window.katex);
        }, { once: true });
        existing.addEventListener("error", function () {
          reject(new Error("KaTeX script failed to load."));
        }, { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = url;
      script.defer = true;
      script.dataset.mpeKatexJs = url;
      script.addEventListener("load", function () {
        resolve(window.katex);
      }, { once: true });
      script.addEventListener("error", function () {
        reject(new Error("KaTeX script failed to load."));
      }, { once: true });
      document.head.appendChild(script);
    });
  }

  async function ensureKatexAssets() {
    if (window.katex && typeof window.katex.render === "function") {
      return window.katex;
    }

    const config = getRuntimeConfig();
    if (!config.katexCssUrl || !config.katexJsUrl) {
      throw new Error("Missing KaTeX asset URLs.");
    }

    if (!katexCssLoader) {
      katexCssLoader = loadStylesheet(config.katexCssUrl).catch(function (error) {
        katexCssLoader = null;
        throw error;
      });
    }

    if (!katexScriptLoader) {
      katexScriptLoader = loadScript(config.katexJsUrl).catch(function (error) {
        katexScriptLoader = null;
        throw error;
      });
    }

    const results = await Promise.all([katexCssLoader, katexScriptLoader]);
    return results[1];
  }

  function renderBlock(block) {
    if (!block || !window.katex || typeof window.katex.render !== "function") {
      return;
    }

    const source = block.getAttribute("data-math") || block.textContent || "";
    if (!source) {
      return;
    }

    try {
      window.katex.render(source, block, {
        displayMode: true,
        throwOnError: false
      });
      block.dataset.mpeMathRendered = "1";
      block.classList.remove("mpe-math-error");
    } catch (error) {
      block.dataset.mpeMathRendered = "0";
      block.classList.add("mpe-math-error");
      block.textContent = source;
    }
  }

  function renderInline(node) {
    if (!node || !window.katex || typeof window.katex.render !== "function") {
      return;
    }

    const source = node.getAttribute("data-math") || node.textContent || "";
    if (!source) {
      return;
    }

    try {
      window.katex.render(source, node, {
        displayMode: false,
        throwOnError: false
      });
      node.dataset.mpeMathRendered = "1";
      node.classList.remove("mpe-math-error");
    } catch (error) {
      node.dataset.mpeMathRendered = "0";
      node.classList.add("mpe-math-error");
      node.textContent = source;
    }
  }

  async function renderWithin(root) {
    const scope = root || document;
    const blocks = scope.querySelectorAll(".mpe-math-block");
    const inlineNodes = scope.querySelectorAll(".mpe-math-inline");
    if (!blocks.length && !inlineNodes.length) {
      return;
    }

    try {
      await ensureKatexAssets();
    } catch (error) {
      return;
    }

    blocks.forEach(renderBlock);
    inlineNodes.forEach(renderInline);
  }

  window.MPEMathRenderer = {
    renderWithin
  };

  document.addEventListener("DOMContentLoaded", function () {
    renderWithin(document);
  });
})();
