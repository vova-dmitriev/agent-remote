export const ScanMode = Object.freeze({
  Worktree: 'worktree',
  Staged: 'staged',
  History: 'history',
});

const privatePath =
  /(^|\/)(?:\.env(?:\..*)?|\.local-data|\.superpowers|\.worktrees|\.cloudflared|\.ssh|artifacts|output|node_modules|dist|build|apps\/desktop\/out|[^/]+\.app|coverage|\.build|\.swiftpm|storybook-static|playwright-report|test-results|credentials[^/]*\.json|[^/]*-credentials\.json|cert\.json|dump\.rdb|appendonlydir)(\/|$)|\.(?:pem|key|p12|pfx|mobileprovision|sqlite(?:-.*)?|db(?:-.*)?|har|cast|mp4|mov|log|jsonl|zip|tgz|gz)$/i;

// scripts/build/ holds the versioned Node build scripts, not build output.
const versionedBuildScripts = /^scripts\/build\/[^/]+\.m?[jt]s$|^scripts\/build\/[^/]+\.d\.mts$/;

export function isPrivatePath(file) {
  return file !== '.env.example' && !versionedBuildScripts.test(file) && privatePath.test(file);
}

export function isUnsafeMode(mode) {
  return mode === '120000' || mode === '160000';
}
