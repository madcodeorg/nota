# @nota/templates

Contains Nota's onboarding, edgeless, and sticker templates.

## Update onboarding content

The readable `onboarding/*.snapshot.json` files are the canonical onboarding sources. Edit those snapshots, preserving the document/block schema and references between starter documents. Use original content or content with established redistribution rights.

From the repository root, regenerate the templates:

```sh
yarn workspace @nota/templates build
```

The package build runs `build-onboarding.mjs`, `build-edgeless.mjs`, and `build-stickers.mjs`. Its `postinstall` script invokes the same build.

`build-onboarding.mjs` creates `onboarding/onboarding.zip` from the snapshot JSON files only. It sorts filenames and uses fixed ZIP entry timestamps for reproducible output. Media assets are not automatically included.

Review and commit the source snapshots and regenerated archive together. `onboarding.spec.ts` checks the generated archive's content. Do not edit the ZIP directly; regenerate it from the committed snapshot sources.
