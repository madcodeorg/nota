# Contributing to Nota

Nota is maintained at [madcodeorg/nota](https://github.com/madcodeorg/nota). Contributions should keep the workspace local-first and preserve offline writing, existing user data, and upstream license notices.

## Before you start

- Search [existing issues](https://github.com/madcodeorg/nota/issues) before reporting a bug or proposing a feature.
- For a substantial behavior or architecture change, open an issue explaining the problem and proposed scope before implementing it.
- Read the [code of conduct](CODE_OF_CONDUCT.md) and [contributor agreement](../.github/CLA.md). The agreement describes the project's contribution licensing terms and signing process.
- Follow [Building Nota](BUILDING.md) to set up the pinned tools. The [codebase tutorial](contributing/tutorial.md) identifies the main packages.

## Making a change

Work on a branch and keep the pull request focused. Reuse existing storage, editor, and AI interfaces. Do not introduce a second canonical meeting database or a separate provider-routing system.

For behavior changes, add a regression test that demonstrates the problem or expected outcome. Run the smallest relevant test first, then the related package checks. The root scripts also provide `yarn typecheck`, `yarn lint`, and `yarn test`; explain any existing failures or checks you could not run.

Before submitting, review the diff for unrelated edits, generated files, personal data, and credentials. Preserve source copyright notices and identify any new third-party code, assets, or model terms in the pull request.

## Pull requests

Explain what problem the change solves, the resulting behavior, and how you validated it. Include screenshots when a visible UI change needs review. Describe data migrations, compatibility limits, or remaining risks when relevant.

Merging a change does not guarantee a release date. Maintainers choose release contents after testing; see the [release process](contributing/releases.md).

## Reporting problems

For public bug reports, include the Nota version, operating system and architecture, reproducible steps, and expected versus actual behavior. Use a minimal sample workspace where possible. Do not attach API keys, authorization tokens, recordings, or private workspace data.

If a report contains sensitive security or conduct details, contact a repository maintainer privately through a contact method they publish instead of posting those details in a public issue.
