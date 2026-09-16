/**
 * What the update strip says about a failed check or download (B-47).
 *
 * electron-updater's messages are made for a log: an HTTP failure is `404 Not Found`, then the
 * request as JSON, then every response header. The strip shows the first line, the tooltip the
 * message without the headers.
 */

const SHORT = 160;
const LONG = 600;

function cap(text: string, length: number): string {
    return text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;
}

/** The first non-empty line, at most 160 characters. */
export function shortUpdateReason(message: string | undefined): string {
    const line = (message ?? '')
        .split('\n')
        .map((part) => part.trim())
        .find((part) => part !== '');
    return cap(line ?? '', SHORT);
}

/** The message without electron-updater's `Headers:` dump, at most 600 characters. */
export function fullUpdateReason(message: string | undefined): string {
    const text = message ?? '';
    const headers = text.indexOf('\nHeaders:');
    return cap((headers === -1 ? text : text.slice(0, headers)).trim(), LONG);
}
