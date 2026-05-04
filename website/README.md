# ZeroAuth Docs Site

This is the local Docusaurus site for ZeroAuth.

Important detail:

- the site reads content from the repository-level `../docs` folder,
- the Docusaurus app in `website/` is only the presentation layer.

## Run from the repo root

```bash
npm run docs:site:start
```

## Run from the website directory

```bash
npm start
```

Default local URL:

```text
http://localhost:3001
```

## Build the site

From the repo root:

```bash
npm run docs:site:build
```

From the `website/` directory:

```bash
npm run build
```

## Content Source of Truth

Edit these files to update the docs:

- `docs/README.md`
- `docs/getting-started/*`
- `docs/concepts/*`
- `docs/integrations/*`
- `docs/operations/*`
- `docs/reference/*`
