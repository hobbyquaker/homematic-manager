import {afterEach, describe, expect, it, vi} from 'vitest';

import {copyBySelection, copyText} from './clipboard.js';

/**
 * Task 47. The Clipboard API is replaced per test on the `navigator` object itself; the fallback's
 * `execCommand` is watched on the document, which also records what was selected when it ran - the
 * only way to see what that command copied without reading the system clipboard.
 */

const restores: (() => void)[] = [];

function shadow(target: object, key: string, value: unknown): void {
    const previous = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, {value, configurable: true, writable: true});
    restores.push(() => {
        if (previous) {
            Object.defineProperty(target, key, previous);
        } else {
            Reflect.deleteProperty(target, key);
        }
    });
}

/** `execCommand('copy')` answering `answer`, and what the focused field held selected at that moment. */
function watchCopyCommand(answer: boolean | Error): {calls: string[]; selected: string[]} {
    const seen = {calls: [] as string[], selected: [] as string[]};
    shadow(document, 'execCommand', (command: string) => {
        seen.calls.push(command);
        const field = document.activeElement;
        if (field instanceof HTMLTextAreaElement) {
            seen.selected.push(field.value.slice(field.selectionStart, field.selectionEnd));
        }
        if (answer instanceof Error) {
            throw answer;
        }
        return answer;
    });
    return seen;
}

afterEach(() => {
    for (const restore of restores.splice(0).reverse()) {
        restore();
    }
    document.body.replaceChildren();
});

describe('copyText (task 47)', () => {
    it('uses the Clipboard API where there is one', async () => {
        const writeText = vi.fn(() => Promise.resolve());
        shadow(navigator, 'clipboard', {writeText});
        const command = watchCopyCommand(true);

        await expect(copyText('Wohnzimmer Stehlampe')).resolves.toBe('clipboard');
        expect(writeText).toHaveBeenCalledExactlyOnceWith('Wohnzimmer Stehlampe');
        expect(command.calls).toEqual([]);
    });

    it('copies through a selected field where the page has no Clipboard API - the addon over plain HTTP', async () => {
        shadow(navigator, 'clipboard', undefined);
        const command = watchCopyCommand(true);

        await expect(copyText('LEQ0000001:1')).resolves.toBe('selection');
        expect(command.calls).toEqual(['copy']);
        expect(command.selected).toEqual(['LEQ0000001:1']);
    });

    it('falls back the same way when the Clipboard API refuses', async () => {
        shadow(navigator, 'clipboard', {
            writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
        });
        const command = watchCopyCommand(true);

        await expect(copyText('Steckdose')).resolves.toBe('selection');
        expect(command.selected).toEqual(['Steckdose']);
    });

    it('says that it failed when the command copies nothing or throws', async () => {
        shadow(navigator, 'clipboard', undefined);
        watchCopyCommand(false);
        await expect(copyText('Steckdose')).resolves.toBe('failed');

        for (const restore of restores.splice(0).reverse()) {
            restore();
        }
        shadow(navigator, 'clipboard', undefined);
        watchCopyCommand(new Error('not supported'));
        await expect(copyText('Steckdose')).resolves.toBe('failed');
    });
});

describe('copyBySelection (task 47)', () => {
    it('leaves no field behind and gives the focus back, whatever the command answers', () => {
        const host = document.createElement('div');
        const button = document.createElement('button');
        host.append(button);
        document.body.append(host);

        for (const answer of [true, false, new Error('not supported')]) {
            for (const restore of restores.splice(0).reverse()) {
                restore();
            }
            const command = watchCopyCommand(answer);
            button.focus();

            expect(copyBySelection('HmIP-PDT 0001D3C99ABCDE', host)).toBe(answer === true);
            expect(command.selected).toEqual(['HmIP-PDT 0001D3C99ABCDE']);
            expect(document.querySelectorAll('textarea')).toHaveLength(0);
            expect(document.activeElement).toBe(button);
        }
    });

    it('puts the field into the host it is given, read-only and out of the tab order', () => {
        const host = document.createElement('div');
        document.body.append(host);
        let parent: Element | null = null;
        let field: HTMLTextAreaElement | undefined;
        shadow(document, 'execCommand', () => {
            field = document.activeElement as HTMLTextAreaElement;
            parent = field.parentElement;
            return true;
        });

        copyBySelection('x', host);
        expect(parent).toBe(host);
        expect(field?.readOnly).toBe(true);
        expect(field?.tabIndex).toBe(-1);
        expect(field?.getAttribute('aria-hidden')).toBe('true');
    });
});
