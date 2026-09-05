# NOTICE

The code in this repository is GPLv3 (see [LICENSE](../LICENSE)). The data artifacts in this
directory are not.

Everything under `data/` that is derived from
[openccu-data](https://github.com/SukramJ/openccu-data) — the easy-mode extract, the profiles, the
translation extract and the device-icon map — is a derivative work of
[OpenCCU-Base](https://github.com/homematicip/OpenCCU-Base) (eQ-3 AG) and keeps the licensing of
those upstream sources: per OpenCCU-Base's `licenses/licenses.md` the `www/` tree these artifacts
are parsed from is published under the **Homematic Software License 2.0** (HMSL 2.0, see
`licenses/HMSL2.txt` there) — in short: free for private and non-commercial use, commercial
redistribution requires permission from eQ-3. openccu-data's own hand-curated
`translation_custom/` overrides are MIT, as is openccu-data's code.

Concretely, in the converted output under `data/dist/`:

| Part                                                                                                            | Origin                                                                                                             | Terms                                         |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| `profiles/*.json`, `master-metadata.json`, `option-presets.json`, `cross-validations.json`, `device-icons.json` | openccu-data `easymode_extract`, `profiles/`, `translation_extract`                                                | HMSL 2.0                                      |
| `translations/de.json`, `translations/en.json`                                                                  | openccu-data `translation_extract` plus its `translation_custom/` overrides                                        | HMSL 2.0, the `translation_custom/` share MIT |
| `translations/tr.json` and the Turkish profile names and descriptions in `profiles/*.json`                      | this project's 2015 easy-mode localisation under `legacy/www/easymodes/localization/tr/`, itself derived from OCCU | HMSL 2.0                                      |
| `icons/*.webp`                                                                                                  | device images of `legacy/www/images/`, copies from a CCU, re-encoded                                               | HMSL 2.0                                      |
| the three `cross_validation.*` messages in `translations/*.json`                                                | written for this project                                                                                           | GPLv3, like the rest of the repository        |
| `sources.json`, `scripts/`, `test/`                                                                             | written for this project                                                                                           | GPLv3                                         |

The pinned upstream artifacts themselves are **not** committed: `npm run fetch` downloads them into
the git-ignored `data/upstream/` and verifies the sha256 recorded in `sources.json`.

"Homematic" and "HomematicIP" are trademarks of eQ-3 AG. This project is not affiliated with or
endorsed by eQ-3 AG.
