module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name !== "@vite-hub/browser" || pkg.version !== "0.0.1") {
        return pkg
      }

      pkg.dependencies = {
        ...pkg.dependencies,
        "@cloudflare/playwright": "^1.3.0",
      }
      delete pkg.peerDependencies?.["@cloudflare/playwright"]
      delete pkg.peerDependenciesMeta?.["@cloudflare/playwright"]
      return pkg
    },
  },
}
