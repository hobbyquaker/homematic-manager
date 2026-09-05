# data

Device metadata for the runtime. Empty so far: it is filled by
[task 9 of the roadmap](../ROADMAP.md#9-device-metadata-pipeline), which will put here

- the pinned [openccu-data](https://github.com/SukramJ/openccu-data) artifacts
  (`easymode_extract`, `profiles/*`, `translation_extract`, `device_icons`), each with the
  openccu-data release they were taken from,
- the converter that turns them into the runtime format `@homematic-manager/core` loads lazily per
  channel type, plus the small bundled webp device-image subset (D-10),
- the 2015 Turkish easy-mode translations of the 2.x code, converted once as a fallback locale
  (D-15),
- the update procedure: bump the pinned openccu-data release, run the converter, diff the runtime
  format, commit.

This replaces `legacy/www/easymodes`, `stringtable.json`, `helpLinkParamset.json`,
`deviceImages.json` and `legacy/tools/convert_*.js`.

The artifacts derived from openccu-data are **not** covered by this repository's GPLv3; see
[NOTICE.md](NOTICE.md).
