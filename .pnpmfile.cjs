// comark-linter names every comark-* package as an optional peer, and pnpm would install npm's copies of all of them
// beside the comark-ui build Drop renders with. Drop lints with that build's plugins (server/utils/markdown-lint.ts and
// the Doctor extension's comark-ui/html), so the linter keeps only the peers it shares with the app.
const LINTER_PEERS = new Set(["comark", "comark-ui", "vite-doctor"])

module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name !== "comark-linter") return pkg
      for (const field of ["peerDependencies", "peerDependenciesMeta"])
        for (const name of Object.keys(pkg[field] ?? {})) if (!LINTER_PEERS.has(name)) delete pkg[field][name]
      return pkg
    },
  },
}
