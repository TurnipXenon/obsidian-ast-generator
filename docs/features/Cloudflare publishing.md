# Cloudflare publishing

When we publish our changes, we want to push our changes, then rebuild the latest stable main build in Cloudflare.

## Current state

Currently, publishing only pushes the changes to the git repo.
We would need to manually rebuild the latest Cloudflare worker build and deploy that.

## Future state

When I publish (src/main.ts:421), right after a successful push, I want to rebuild, then wait for it to finish, then deploy that build in Cloudflare. We will have to have another field in our Settings that would be for the parameters needed to interact with Cloudflare's Worker APIs. I don't know if we need anything else for deployment. Each folder base needs its own Cloudflare parameters.

To understand what the receiving Cloudflare worker looks like, see the wranger config at `~\Projects\Web\pineapple\wrangler.jsonc`.
