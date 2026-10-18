module.exports = {
  packagerConfig: {
    asar: true,
    appBundleId: 'com.agentremote.desktop',
    executableName: 'Agent Remote',
    extraResource: ['dist/desktop-companion'],
    ignore: [/^\/dist\/desktop-companion(?:\/|$)/, /^\/node_modules(?:\/|$)/],
    prune: false,
  },
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
  ],
  hooks: {
    postPackage: async (_config, { outputPaths, platform, arch }) => {
      const { finalizePackagedDesktop } = await import('../../scripts/desktop/finalize-package.mjs');

      await finalizePackagedDesktop({ outputPaths, platform, arch });
    },
  },
};
