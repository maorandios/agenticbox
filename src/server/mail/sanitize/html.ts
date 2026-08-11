import sanitizeHtml from "sanitize-html";

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat([
    "img",
    "h1",
    "h2",
    "h3",
    "span",
    "div",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "td",
    "th",
    "colgroup",
    "col",
    "hr",
    "br",
    "center",
    "font",
  ]),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    "*": ["dir", "lang", "class", "id", "style", "align"],
    a: ["href", "name", "target", "rel"],
    img: ["src", "alt", "title", "width", "height", "border"],
    table: [
      "width",
      "height",
      "border",
      "cellpadding",
      "cellspacing",
      "bgcolor",
      "align",
      "role",
    ],
    td: ["width", "height", "colspan", "rowspan", "bgcolor", "valign", "align"],
    th: ["width", "height", "colspan", "rowspan", "bgcolor", "valign", "align"],
    tr: ["bgcolor", "align", "valign"],
    col: ["width", "span"],
    font: ["size", "color", "face"],
  },
  allowedStyles: {
    "*": {
      // Layout needed for marketing/order tables; no positioning/expressions.
      width: [/^\d+(?:px|%|em|rem)?$/i],
      "max-width": [/^\d+(?:px|%|em|rem)?$/i],
      "min-width": [/^\d+(?:px|%|em|rem)?$/i],
      height: [/^\d+(?:px|%|em|rem)?$/i],
      "max-height": [/^\d+(?:px|%|em|rem)?$/i],
      padding: [/^[\d .pxemrem%]+$/i],
      "padding-top": [/^\d+(?:px|%|em|rem)?$/i],
      "padding-right": [/^\d+(?:px|%|em|rem)?$/i],
      "padding-bottom": [/^\d+(?:px|%|em|rem)?$/i],
      "padding-left": [/^\d+(?:px|%|em|rem)?$/i],
      margin: [/^[\d .pxemrem%auto]+$/i],
      "margin-top": [/^\d+(?:px|%|em|rem)?$/i],
      "margin-right": [/^\d+(?:px|%|em|rem)?$|^auto$/i],
      "margin-bottom": [/^\d+(?:px|%|em|rem)?$/i],
      "margin-left": [/^\d+(?:px|%|em|rem)?$|^auto$/i],
      "text-align": [/^(left|right|center|justify|start|end)$/i],
      "vertical-align": [/^(top|middle|bottom|baseline)$/i],
      "font-size": [/^\d+(?:px|pt|em|rem|%)$/i],
      "font-weight": [/^(normal|bold|bolder|lighter|\d{3})$/i],
      "font-style": [/^(normal|italic|oblique)$/i],
      "line-height": [/^\d+(?:\.\d+)?(?:px|em|rem|%)?$/i],
      color: [
        /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i,
        /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/i,
      ],
      "background-color": [
        /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i,
        /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/i,
        /^transparent$/i,
      ],
      border: [/^[\w\s.#(),%]+$/i],
      "border-collapse": [/^(collapse|separate)$/i],
      "border-spacing": [/^[\d .px]+$/i],
      "white-space": [/^(normal|nowrap|pre-wrap)$/i],
      direction: [/^(ltr|rtl)$/i],
    },
  },
  allowedSchemes: ["http", "https", "mailto", "cid"],
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", {
      rel: "noopener noreferrer",
      target: "_blank",
    }),
  },
};

export type SanitizeResult = {
  sanitizedHtml: string | null;
  plainText: string | null;
  extractionStatus: "sanitized_ok" | "sanitize_failed" | "pending";
};

export function sanitizeEmailHtml(rawHtml: string | null | undefined): SanitizeResult {
  if (rawHtml == null || rawHtml.trim() === "") {
    return {
      sanitizedHtml: null,
      plainText: null,
      extractionStatus: "pending",
    };
  }

  try {
    const sanitizedHtml = sanitizeHtml(rawHtml, SANITIZE_OPTIONS);
    const plainText = sanitizeHtml(sanitizedHtml, {
      allowedTags: [],
      allowedAttributes: {},
    })
      .replace(/\s+/g, " ")
      .trim();

    return {
      sanitizedHtml,
      plainText: plainText || null,
      extractionStatus: "sanitized_ok",
    };
  } catch {
    return {
      sanitizedHtml: null,
      plainText: null,
      extractionStatus: "sanitize_failed",
    };
  }
}
