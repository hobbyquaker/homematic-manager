/**
 * The value shapes that cross the XML-RPC / BIN-RPC boundary.
 *
 * The CCU sends plain JSON scalars. Writing is asymmetric: an XML-RPC `double` has to be marked
 * explicitly, because a JavaScript `1` would otherwise be encoded as `<int>` and a `FLOAT`
 * parameter written as an int is rejected by hmipserver. Both client libraries (homematic-xmlrpc,
 * binrpc) understand the `{explicitDouble}` wrapper, which is why the core produces it.
 */

/** Marks a number that must be encoded as an XML-RPC `double`. */
export interface ExplicitDouble {
    readonly explicitDouble: number;
}

/** A parameter value as the CCU sends it. */
export type ParamsetValue = boolean | number | string;

/** A parameter value as it is written back. */
export type RpcWriteValue = boolean | number | string | ExplicitDouble;

/** A `getParamset` result. */
export type Paramset = Readonly<Record<string, ParamsetValue>>;

/** A `putParamset` payload. */
export type ParamsetWrite = Record<string, RpcWriteValue>;

/** Is this the `{explicitDouble}` wrapper? */
export function isExplicitDouble(value: unknown): value is ExplicitDouble {
    return (
        typeof value === 'object' &&
        value !== null &&
        'explicitDouble' in value &&
        typeof (value as ExplicitDouble).explicitDouble === 'number'
    );
}

/** The plain number behind a value, unwrapping {@link ExplicitDouble}; `undefined` for the rest. */
export function unwrapNumber(value: RpcWriteValue | undefined): number | undefined {
    if (typeof value === 'number') {
        return value;
    }
    return isExplicitDouble(value) ? value.explicitDouble : undefined;
}

/** Compares two written values; `{explicitDouble: 1}` and `1` are the same value. */
export function sameValue(a: RpcWriteValue | undefined, b: RpcWriteValue | undefined): boolean {
    const left = unwrapNumber(a);
    const right = unwrapNumber(b);
    if (left !== undefined || right !== undefined) {
        return left === right;
    }
    return a === b;
}
