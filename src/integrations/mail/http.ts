import { MailError } from './errors.js';
import { DOWNLOAD_LIMIT } from './types.js';

// Bound downloads even when the upstream server omits Content-Length.
export async function readDownload(response: Response, limit = DOWNLOAD_LIMIT): Promise<Buffer> {
    if (Number(response.headers.get('content-length')) > limit) {
        await response.body?.cancel();
        throw new MailError(413, 'Download exceeds the 25 MiB limit. Open it in your mail provider.');
    }
    const reader = response.body?.getReader();
    if (!reader) return Buffer.alloc(0);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > limit) {
                await reader.cancel();
                throw new MailError(413, 'Download exceeds the 25 MiB limit. Open it in your mail provider.');
            }
            chunks.push(value);
        }
        return Buffer.concat(chunks);
    } finally {
        reader.releaseLock();
    }
}
