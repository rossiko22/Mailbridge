import sanitizeHtml from 'sanitize-html';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const color = /^(?:#[\da-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\))$/i;
const length = /^(?:0|auto|\d+(?:\.\d+)?(?:px|pt|em|rem|%))(?:\s+(?:0|auto|\d+(?:\.\d+)?(?:px|pt|em|rem|%))){0,3}$/;
const border = /^(?:\d+(?:px|pt)\s+)?(?:solid|dashed|dotted|none)(?:\s+(?:#[\da-f]{3,8}|[a-z]+))?$/i;

export function emailCsp(images = false) {
    return `default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src ${images ? 'https:' : "'none'"}; font-src 'none'; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-same-origin allow-popups allow-popups-to-escape-sandbox`;
}

// Formatting is intentionally a small allowlist. No sender CSS can make network
// requests or escape the isolated reader, even when remote images are enabled.
export function renderEmail(body: { content: string; contentType: string; warning?: string }, images = false) {
    let hasRemoteImages = false;
    const html = body.contentType.toLowerCase() === 'html';
    const content = html ? sanitizeHtml(body.content, {
        allowedTags: ['div', 'span', 'p', 'br', 'hr', 'a', 'img', 'b', 'strong', 'i', 'em', 'u', 's', 'small', 'sub', 'sup',
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
            'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'center', 'font'],
        allowedAttributes: {
            '*': ['style', 'dir', 'lang'], a: ['href', 'title', 'target', 'rel'],
            img: ['src', 'alt', 'width', 'height', 'title', 'referrerpolicy'],
            table: ['width', 'align', 'cellpadding', 'cellspacing', 'border', 'bgcolor', 'role'],
            td: ['width', 'height', 'colspan', 'rowspan', 'align', 'valign', 'bgcolor'],
            th: ['width', 'colspan', 'rowspan', 'align', 'valign', 'bgcolor'], font: ['color', 'face', 'size'],
        },
        allowedSchemes: ['https', 'http', 'mailto'], allowedSchemesByTag: { img: ['https'] }, allowProtocolRelative: false,
        allowedStyles: { '*': {
            color: [color], 'background-color': [color], 'font-family': [/^[\w\s,'"-]+$/],
            'font-size': [length], 'font-weight': [/^(?:normal|bold|[1-9]00)$/], 'font-style': [/^(?:normal|italic)$/],
            'line-height': [/^[\d.]+(?:px|pt|em|rem|%)?$/], 'text-align': [/^(?:left|right|center|justify)$/],
            'text-decoration': [/^(?:none|underline|line-through)$/], 'vertical-align': [/^(?:top|middle|bottom|baseline)$/],
            'white-space': [/^(?:normal|pre-wrap|pre-line)$/], display: [/^(?:none|block|inline|inline-block|table|table-row|table-cell)$/],
            width: [length], 'max-width': [length], height: [length], 'max-height': [length],
            margin: [length], 'margin-top': [length], 'margin-bottom': [length], 'margin-left': [length], 'margin-right': [length],
            padding: [length], 'padding-top': [length], 'padding-bottom': [length], 'padding-left': [length], 'padding-right': [length],
            border: [border], 'border-top': [border], 'border-bottom': [border], 'border-radius': [length], 'border-collapse': [/^(?:collapse|separate)$/],
        } },
        transformTags: {
            a: (_tag, attributes) => {
                const href = /^(?:https?:\/\/|mailto:)/i.test(attributes.href ?? '') ? attributes.href : undefined;
                return { tagName: 'a', attribs: { ...attributes, ...(href ? { href } : { href: '' }), target: '_blank', rel: 'noopener noreferrer' } };
            },
            img: (_tag, attributes) => {
                const remote = /^https:\/\//i.test(attributes.src ?? '');
                hasRemoteImages ||= remote;
                if (!images || !remote) return { tagName: 'span', attribs: {}, text: attributes.alt || '' };
                return { tagName: 'img', attribs: { ...attributes, referrerpolicy: 'no-referrer' } };
            },
        },
    }) : `<div class="plain">${plainLinks(body.content)}</div>`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>Email message</title>
<style>html{color-scheme:light;background:white}body{margin:0;padding:24px;font:14px/1.6 Arial,Helvetica,sans-serif;color:#253047;overflow-wrap:anywhere}body>div{max-width:100%}table{max-width:100%!important}img{max-width:100%!important;object-fit:contain}a{color:#245bd7}pre,.plain{white-space:pre-wrap;overflow-wrap:anywhere}blockquote{margin:16px 0;padding-left:16px;border-left:3px solid #dbe2ee;color:#64748b}@media(max-width:480px){body{padding:12px}td,th{overflow-wrap:anywhere}}</style></head><body data-email-document="true" data-remote-images="${hasRemoteImages}" data-warning="${escapeHtml(body.warning || '')}" data-format="${html ? 'html' : 'text'}">${content}</body></html>`;
}

// Readable fallback for Graph's HTML-to-text output: retain link labels, not
// opaque tracking query strings. Never infer or unwrap tracking destinations.
function plainLinks(text: string) {
    text = text.replace(/[\u200b-\u200f\u2060\ufeff]/g, '').replace(/[ \t]{3,}/g, ' ');
    const pattern = /\[([^\]\n]+)\]\s*<(https?:\/\/[^<>\s]+)>|([^\n<>]{1,100}?)<(https?:\/\/[^<>\s]+)>|\[(https?:\/\/[^\]\s]+)\]|https?:\/\/[^\s<>"']+/g;
    let result = ''; let offset = 0;
    for (const match of text.matchAll(pattern)) {
        result += escapeHtml(text.slice(offset, match.index));
        if (match[5]) { offset = match.index + match[0].length; continue; }
        const url = match[2] || match[4] || match[0];
        let label = (match[1] || match[3] || '').trim();
        if (/^https?:\/\//i.test(label)) label = '';
        if (!label) { try { label = new URL(url).hostname; } catch { label = 'Open link'; } }
        result += `<a href="${escapeHtml(url)}" title="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
        offset = match.index + match[0].length;
    }
    return result + escapeHtml(text.slice(offset));
}
