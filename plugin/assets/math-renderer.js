(function () {
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

  function renderWithin(root) {
    const scope = root || document;
    const blocks = scope.querySelectorAll(".mpe-math-block");
    const inlineNodes = scope.querySelectorAll(".mpe-math-inline");
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
