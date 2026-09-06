# Conformance fixtures

The corpus every implementation of the metadata store runs (D-16): `occulited` in Go and
homematic-manager's `local` provider in TypeScript. If both pass, they agree; if one changes the
semantics without changing a fixture here, that is the bug.

## Layout

- `store/valid-*.json` — documents that must load. `store/invalid-*.json` — documents that must be
  refused; the top-level `_reason` key names the error code expected (it is stripped before parsing
  and never counts as part of the document).
- `cases/*.json` — operation sequences against a starting document, with the expected outcome of
  every step. This is where the semantics live.

## A case

```json
{
  "title": "what this proves",
  "start": "empty" | { ...document... },
  "ops": [
    { "op": "object.set", "ref": "BidCos-RF.JEQ0230153:1", "body": {"name": "Heizung"}, "expect": {"ok": true, "revision": 1} },
    { "op": "objects.query", "enum": "room/eg", "expect": {"refs": ["..."]} },
    { "op": "node.delete", "path": "room/eg", "expect": {"error": "has-members"} }
  ],
  "end": { "revision": 7, "objects": {...}, "enums": {...} }
}
```

- `start`: `"empty"` means a fresh store (revision 0, the three default enums with empty trees).
- `ops` run in order. Each `expect` is either `{"ok": true, "revision": N}` (N is the revision
  after the op), `{"ok": true, "unchanged": true}` (a no-op that must not bump the revision),
  `{"error": "<code>"}`, or, for reads, the expected value.
- `end`, when present, is compared **structurally** against the store after the last op: keys in
  `end` must match; keys absent from `end` are not checked. `revision` in `end` is always checked.

## Operations

| op | fields | maps to |
| --- | --- | --- |
| `object.set` | `ref`, `body` (PATCH semantics) | `PATCH /objects/{ref}` |
| `object.put` | `ref`, `body` (replace) | `PUT /objects/{ref}` |
| `object.get` | `ref` → expect `{"value": ...}` or error | `GET /objects/{ref}` |
| `object.delete` | `ref` | `DELETE /objects/{ref}` |
| `objects.query` | `enum` (path), `orphaned`? → expect `{"refs": [sorted]}` | `GET /objects?enum=` |
| `objects.bulk` | `set`, `delete` | `POST /objects:bulk` |
| `enum.create` | `id`, `name` | `POST /enums` |
| `enum.delete` | `id`, `members`? | `DELETE /enums/{id}` |
| `node.create` | `enum`, `parent` (path or null), `id`, `name`, `icon`?, `position`? | `POST /enums/{e}/nodes` |
| `node.update` | `path`, `body` (`name`/`icon`/`parent`/`position`) | `PATCH /enums/{e}/nodes/{path}` |
| `node.delete` | `path`, `members`? | `DELETE /enums/{e}/nodes/{path}` |
| `orphan.set` | `ref`, `orphaned` | owner-only; sets the flag |
| `import` | `document`, `mode`? | `PUT /import` |
| `events.since` | `since` → expect `{"kinds": [...]}` or `{"resync": true}` | change stream replay |

Implementations run the corpus from a test that walks these directories; the Go runner is
`internal/meta/conformance_test.go`, and the TypeScript one lives next to the `local` provider.
