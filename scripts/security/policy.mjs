export const ScanMode = Object.freeze({
  Worktree: 'worktree',
  Staged: 'staged',
  History: 'history',
});

const privatePath =
  /(^|\/)(?:\.env(?:\..*)?|\.local-data|\.superpowers|\.worktrees|\.cloudflared|\.ssh|artifacts|output|node_modules|dist|build|apps\/desktop\/out|[^/]+\.app|coverage|\.build|\.swiftpm|storybook-static|playwright-report|test-results|credentials[^/]*\.json|[^/]*-credentials\.json|cert\.json|dump\.rdb|appendonlydir)(\/|$)|\.(?:pem|key|p12|pfx|mobileprovision|sqlite(?:-.*)?|db(?:-.*)?|har|cast|mp4|mov|log|jsonl|zip|tgz|gz)$/i;

export function isPrivatePath(file) {
  // scripts/build/ holds versioned Node build scripts, not build output: neutralise only that directory segment.
  const checked = file.replace(/^scripts\/build\/(?=[^/]+$)/, 'scripts/');

  return file !== '.env.example' && privatePath.test(checked);
}

export function isUnsafeMode(mode) {
  return mode === '120000' || mode === '160000';
}
