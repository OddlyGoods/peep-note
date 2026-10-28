# Publishing PeepNote releases

This guide is for maintainers building installers and publishing app updates.

## GitHub Actions

The **Build and release PeepNote** workflow builds Windows x64 NSIS installers and Ubuntu amd64 Debian packages. A manual workflow run on a branch produces downloadable Actions artifacts without publishing. Pushing a stable `v*` tag matching the version in `package.json` builds both platforms, validates metadata and checksums, uploads all assets to a draft release, and publishes it after both builds succeed.

Repository Actions must be enabled. Publishing uses the workflow's built-in `GITHUB_TOKEN`; end-user apps do not contain a GitHub token. Published releases are never overwritten.

## Publish a new version

Start from a clean working tree after committing the intended changes. Use `npm version patch` (or the appropriate minor/major bump) to update `package.json` and `package-lock.json` and create a matching commit and tag.

```bash
npm version patch
git push origin main
git push origin "v$(node -p "require('./package.json').version")"
```

Follow the workflow in the repository's **Actions** tab. Never move a previously published tag. The updater compares version numbers; changing files without increasing the version does not create an update.

Release assets must include:

- The Windows `.exe` and `.exe.blockmap`
- `latest.yml`
- The Linux `.deb`
- `latest-linux.yml`

The workflow verifies the complete set before making the release visible to installed apps. If a run fails before publication, fix the cause and rerun the failed jobs; an existing draft can be completed on retry.

## Update behavior

Installed Windows NSIS and Ubuntu `.deb` builds check GitHub Releases three seconds after startup, then every six hours. Users can also check manually in Settings. Downloads and installation require explicit user actions; updates are not installed on normal app exit. Update state survives navigation.

On Ubuntu, installation uses `pkexec`/Polkit and `dpkg` with the checksum-verified `.deb`. A Polkit authentication agent and `pkexec` must be available. If authentication is cancelled or installation fails, the app remains open and the downloaded installer can be retried. Windows uses the NSIS updater. Unpacked and development builds do not support in-app updates.

Application data stays in the user data directory, outside the installed application. In-app updating was first implemented in version 1.0.14; older installations may require a manual installer update first.

## Validate installed updates

Before a public rollout, validate on real installed copies of both operating systems:

1. Install an older build and create a note with an attachment and settings.
2. Publish a higher test version, then check and download it from the installed app.
3. Navigate between detail, list, and settings views during the update flow.
4. Restart to install and verify the new version and original data.
5. Test network interruption and cancelling Ubuntu administrator authentication.

Use a dedicated test feed/repository for test releases and installed builds to avoid updating production users during validation. Automated tests use simulated update backends and fixture installers; they do not replace these operating-system installation checks.
