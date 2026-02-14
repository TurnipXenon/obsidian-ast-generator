# Publish staging

We want to be able to publish a single page during a certain period and not all pages at the current time.

## Current state

All pages are published when we generate AST (src/Settings.ts:1695) and click publishChange (src/main.ts:374).

## Future state

- [ ] I want to be able to save a page as draft (a command palette or integrated in the generate AST ribbon), which would generate a `*.draft.ast.json` that is never recorded in main.meta.json `src/Settings.ts:1728`.
    - [ ] For the sake of human readability, when I save as draft, save a version of the file as `*.draft.md` which generate AST should avoid
- [ ] I want to be able to save a page as published (a command palette or the original generate AST ribbon but differentiate for the feature above), which would just be `*.ast.json`
    - [ ] The brand new challenge with individually generating AST is that we need to publish all referenced medias (image, videos, pdfs, wikilinks?), but not unpublished *.md (usually wikilinks).
    - [ ] For the sake of human readability, when I save as published, save a version of the file as `*.published.md`, which generate AST should avoid
