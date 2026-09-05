import {describe, expect, it} from 'vitest';

import {createLogger, isLogLevel, LOG_LEVELS, silentLogger} from './log.js';

function recording(level?: 'error' | 'warn' | 'info' | 'debug'): {
    lines: string[];
    log: ReturnType<typeof createLogger>;
} {
    const lines: string[] = [];
    const log = createLogger({
        ...(level === undefined ? {} : {level}),
        write: (entry, line) => lines.push(`${entry}|${line}`),
        now: () => new Date('2026-09-05T10:00:00.000Z'),
    });
    return {lines, log};
}

describe('createLogger', () => {
    it('drops everything below the configured level', () => {
        const {lines, log} = recording('warn');
        log.error('a');
        log.warn('b');
        log.info('c');
        log.debug('d');
        expect(lines.map((line) => line.split('|')[0])).toEqual(['error', 'warn']);
    });

    it('defaults to info', () => {
        const {lines, log} = recording();
        log.info('shown');
        log.debug('hidden');
        expect(lines).toHaveLength(1);
    });

    it('writes a timestamp and a padded level', () => {
        const {lines, log} = recording('debug');
        log.info('hello');
        expect(lines[0]).toBe('info|2026-09-05T10:00:00.000Z INFO  hello');
    });

    it('formats errors by their message and objects as json', () => {
        const {lines, log} = recording('debug');
        log.error('failed:', new Error('boom'));
        log.debug('config:', {port: 1});
        expect(lines[0]).toContain('failed: boom');
        expect(lines[1]).toContain('config: {"port":1}');
    });

    it('falls back to String() for what json cannot hold', () => {
        const {lines, log} = recording('debug');
        const circular: Record<string, unknown> = {};
        circular['self'] = circular;
        log.info(circular);
        log.info(undefined);
        expect(lines[0]).toContain('[object Object]');
        expect(lines[1]).toContain('undefined');
    });

    it('sends errors and warnings to stderr and the rest to stdout', () => {
        const written: string[] = [];
        const out = process.stdout.write.bind(process.stdout);
        const error = process.stderr.write.bind(process.stderr);
        process.stdout.write = ((line: string) => (written.push(`out:${line}`), true)) as typeof process.stdout.write;
        process.stderr.write = ((line: string) => (written.push(`err:${line}`), true)) as typeof process.stderr.write;
        try {
            const log = createLogger({level: 'debug'});
            log.info('one');
            log.warn('two');
            log.error('three');
        } finally {
            process.stdout.write = out;
            process.stderr.write = error;
        }
        expect(written.map((line) => line.slice(0, 4))).toEqual(['out:', 'err:', 'err:']);
    });
});

describe('isLogLevel', () => {
    it('accepts the four names and nothing else', () => {
        expect(LOG_LEVELS.every((level) => isLogLevel(level))).toBe(true);
        expect(isLogLevel('verbose')).toBe(false);
        expect(isLogLevel(3)).toBe(false);
    });
});

describe('silentLogger', () => {
    it('accepts every call and says nothing', () => {
        expect(() => {
            silentLogger.error('a');
            silentLogger.warn('a');
            silentLogger.info('a');
            silentLogger.debug('a');
        }).not.toThrow();
    });
});
