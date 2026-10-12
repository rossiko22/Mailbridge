// A portable text snapshot of the saved record. The original MIME comes from the provider instead.
export function storedEml(email: { id: string; subject: string; senderName: string; senderAddress: string; receivedAt: string | Date | null; body: string }, mailbox: string): string {
    const clean = (value: string) => value.replace(/[\r\n\x00-\x1f\x7f]/g, ' ');
    const encoded = (value: string) => {
        // Split by code point to avoid splitting a UTF-8 sequence in encoded words.
        const chunks: string[] = []; let chunk = '';
        for (const char of clean(value)) {
            if (Buffer.byteLength(chunk + char) > 42) { chunks.push(chunk); chunk = ''; }
            chunk += char;
        }
        if (chunk) chunks.push(chunk);
        return chunks.map(part => `=?UTF-8?B?${Buffer.from(part).toString('base64')}?=`).join('\r\n ');
    };
    const address = (value: string) => /^[^\s@<>]+@[^\s@<>]+$/.test(value) ? value : 'unknown@example.invalid';
    const body = Buffer.from(email.body.replace(/\r?\n/g, '\r\n')).toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? '';
    const date = email.receivedAt ? new Date(email.receivedAt) : null;
    return [
        `From: ${encoded(email.senderName || email.senderAddress)} <${address(email.senderAddress)}>`,
        `To: <${address(mailbox)}>`, `Subject: ${encoded(email.subject)}`,
        ...(date && !Number.isNaN(date.getTime()) ? [`Date: ${date.toUTCString()}`] : []),
        `Message-ID: <${email.id}@mail.local>`, 'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64',
        'X-Mail-Export: stored-text-snapshot', '', body, '',
    ].join('\r\n');
}
