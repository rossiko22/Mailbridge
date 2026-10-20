// Small, dependency-free helpers for the parts of RFC 5322 / 2047 the app needs.

const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
};
export function decodeEntities(value: string): string {
    return value
        .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, match => entities[match] ?? match)
        .replace(/&#(\d{1,6});/g, (_m, code: string) => {
            try {
                return String.fromCodePoint(Number(code));
            } catch {
                return '';
            }
        });
}

export function htmlToText(html: string): string {
    return decodeEntities(
        html
            .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
            .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6])>/gi, '\n')
            .replace(/<[^>]+>/g, ' '),
    )
        .replace(/[ \t]+/g, ' ')
        .replace(/ ?\n ?/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function base64UrlToBuffer(value: string): Buffer {
    return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
export function bufferToBase64Url(value: Buffer): string {
    return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// RFC 2047 encoded words ("=?UTF-8?B?...?=") as they appear in raw Subject/From headers.
export function decodeMimeWords(value: string): string {
    return value.replace(/=\?([\w-]+)\?([bBqQ])\?([^?]*)\?=(?:\s+(?==\?))?/g, (_match, charset: string, encoding: string, text: string) => {
        try {
            const bytes =
                encoding.toLowerCase() === 'b'
                    ? Buffer.from(text, 'base64')
                    : Buffer.from(
                          text
                              .replace(/_/g, ' ')
                              .replace(/=([0-9a-fA-F]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16))),
                          'latin1',
                      );
            return new TextDecoder(charset.toLowerCase()).decode(bytes);
        } catch {
            return text;
        }
    });
}

// Splits by code point so a multi-byte character is never cut between encoded words.
export function encodeMimeWords(value: string): string {
    const clean = value.replace(/[\r\n\x00-\x1f\x7f]/g, ' ');
    if (/^[\x20-\x7e]*$/.test(clean)) return clean;
    const chunks: string[] = [];
    let chunk = '';
    for (const char of clean) {
        if (Buffer.byteLength(chunk + char) > 42) {
            chunks.push(chunk);
            chunk = '';
        }
        chunk += char;
    }
    if (chunk) chunks.push(chunk);
    return chunks.map(part => `=?UTF-8?B?${Buffer.from(part).toString('base64')}?=`).join('\r\n ');
}

export function parseAddress(value: string | undefined): { name: string; address: string } {
    const text = decodeMimeWords(value ?? '').trim();
    const bracket = /^(.*?)<([^<>\s]+@[^<>\s]+)>\s*$/.exec(text);
    if (bracket)
        return {
            name: (bracket[1] ?? '')
                .trim()
                .replace(/^"(.*)"$/, '$1')
                .replace(/\\(.)/g, '$1')
                .trim(),
            address: bracket[2]!.trim(),
        };
    return /^[^\s@<>]+@[^\s@<>]+$/.test(text) ? { name: '', address: text } : { name: text, address: '' };
}

export interface RawMessage {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    body: string;
    inReplyTo?: string;
    references?: string;
}

const header = (value: string) => value.replace(/[\r\n\x00-\x1f\x7f]/g, ' ').trim();

// A plain-text RFC 5322 message. The sender header is deliberately left to the provider.
export function buildRawMessage(message: RawMessage): string {
    const lines = [
        `To: ${message.to.map(header).join(', ')}`,
        ...(message.cc?.length ? [`Cc: ${message.cc.map(header).join(', ')}`] : []),
        ...(message.bcc?.length ? [`Bcc: ${message.bcc.map(header).join(', ')}`] : []),
        `Subject: ${encodeMimeWords(message.subject)}`,
        ...(message.inReplyTo ? [`In-Reply-To: ${header(message.inReplyTo)}`] : []),
        ...(message.references ? [`References: ${header(message.references)}`] : []),
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        (
            Buffer.from(message.body.replace(/\r?\n/g, '\r\n'))
                .toString('base64')
                .match(/.{1,76}/g) ?? []
        ).join('\r\n'),
        '',
    ];
    return lines.join('\r\n');
}

export function quoteText(value: string): string {
    return value
        .split(/\r?\n/)
        .map(line => `> ${line}`)
        .join('\n');
}
