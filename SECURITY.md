# Local data and credentials

Open PeepNote has no application accounts, login service, JWT signing key or session token. All app windows use one local profile. Operating-system users retain separate data directories. The desktop API binds to IPv4 loopback only and rejects unrelated Host/Origin headers and cross-site browser requests. It is not intended to be exposed as a network service.

User notes, attachments, screenshots, recordings, optional AI provider keys and the hashed secret-note PIN are stored in the local app data directory. They are not part of the source repository. The secret-note PIN is a UI convenience lock; files and the database are not encrypted. Anyone with access to this OS account can access its local app data.

AI requests are sent only when the user requests a group summary with their own configured provider key. Release update checks contact the public GitHub repository. No application authentication server is contacted.

Never commit `.env` files, local databases, provider keys, private keys or copied user data. `npm run test:privacy` scans the source and reachable Git history for common credential and personal-data patterns, printing locations without values. This is a heuristic source audit, not a guarantee that every possible secret format can be detected. GitHub Actions tokens are supplied by GitHub at job runtime and must never be embedded in release builds.
