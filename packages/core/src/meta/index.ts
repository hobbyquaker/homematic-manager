/**
 * The metadata model of openccu-lite (their D-16), in one place.
 *
 * `types` is the format, `paths` its small rules, `document` the validator, `store` every operation
 * of the API with its revisions, and `view` the way from a tree to the arrays of names every
 * consumer downstream has always been given.
 */

export * from './types.js';
export * from './paths.js';
export * from './document.js';
export * from './store.js';
export * from './view.js';
export * from './tree.js';
export * from './slug.js';
export * from './follow.js';
