# Obsidian Blog Publisher

A fork of the [Obsidian Kanban Plugin](https://github.com/mgmeyers/obsidian-kanban) retrofitted as a personal blog publishing tool.

## What it does

Uses the Kanban board UI as a content management interface for blog posts stored as Obsidian markdown files. Each lane represents a stage (e.g. draft, review, published) and each card is a blog post.

On top of the standard Kanban functionality, this fork adds:

- **AST generation** — serializes the board and its markdown content into a JSON structure consumable by the blog frontend
- **Vercel auto-deploy** — triggers a production deployment to Vercel (targeting the `TurnipXenon/turnip` repo) with a single click, polling until the deployment succeeds and aliasing it as `content-update`
- **Ribbon shortcuts** — "Generate AST" and "Publish changes" buttons in the Obsidian sidebar

## How it works

Markdown files in your vault are parsed into a `Board > Lane > Item` data model. When you publish, the plugin serializes that model to JSON (the AST) and kicks off a Vercel deployment via the Vercel SDK. The blog frontend consumes that JSON to render posts.

## Fork baseline

Changes relative to upstream Obsidian Kanban begin at commit `d8eaecacc3703a57c16b400d3bea6428b0dbfaee`.
