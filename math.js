// Renders LaTeX math notation (\[ ... \] for display, \( ... \) for inline)
// embedded in markdown source using KaTeX.
//
// markdown-it has no concept of math, and its backslash-escaping rules mangle
// LaTeX source unpredictably (e.g. "\[" loses its backslash because "[" is an
// escapable character, while "\times" keeps its backslash because letters
// aren't escapable) -- producing garbled leftovers like "[ P = V \times I ]"
// in the preview. To avoid that, math blocks are pulled out of the markdown
// text *before* markdown-it ever sees them, replaced with opaque placeholder
// tokens, and swapped back in as real KaTeX HTML after markdown-it has
// rendered everything else.

const katex = require('katex');

const MARK = '';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Pulls \[ ... \] (display) and \( ... \) (inline) math out of raw markdown
// text, replacing each with a unique placeholder token. Display math is
// padded with blank lines so markdown-it always parses it as its own
// paragraph, regardless of the surrounding whitespace in the source.
function extractMath(text) {
  const mathBlocks = [];
  let counter = 0;

  const stash = (latex, display) => {
    const token = `${MARK}MATH${counter}${MARK}`;
    counter += 1;
    mathBlocks.push({ token, latex: latex.trim(), display });
    return token;
  };

  let out = String(text || '');
  out = out.replace(/\\\[([\s\S]+?)\\\]/g, (match, latex) => `\n\n${stash(latex, true)}\n\n`);
  out = out.replace(/\\\(([\s\S]+?)\\\)/g, (match, latex) => stash(latex, false));

  return { text: out, mathBlocks };
}

// Swaps placeholder tokens in rendered HTML back out for real KaTeX markup.
function renderMathHtml(html, mathBlocks) {
  let out = html;
  for (const { token, latex, display } of mathBlocks) {
    let rendered;
    try {
      rendered = katex.renderToString(latex, {
        displayMode: display,
        throwOnError: false, // render a red error span instead of crashing on bad LaTeX
        strict: false,
      });
    } catch (err) {
      rendered = `<span style="color:#dc2626;">[math error: ${escapeHtml(latex)}]</span>`;
    }
    out = out.split(token).join(rendered);
  }
  return out;
}

// Convenience: render markdown text containing math, given a markdown-it
// instance. Used by the live preview / PDF path, which can display KaTeX's
// HTML+CSS output natively.
function renderMarkdownWithMath(md, text) {
  const { text: substituted, mathBlocks } = extractMath(text);
  const html = md.render(substituted);
  return renderMathHtml(html, mathBlocks);
}

module.exports = { extractMath, renderMathHtml, renderMarkdownWithMath, escapeHtml };
