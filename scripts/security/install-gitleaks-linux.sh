#!/usr/bin/env bash
set -euo pipefail

# CI-only installer. Local macOS development uses Homebrew.
test "$(uname -s)" = Linux
test "$(uname -m)" = x86_64
gitleaks_version=8.30.1
archive="gitleaks_${gitleaks_version}_linux_x64.tar.gz"
checksums="gitleaks_${gitleaks_version}_checksums.txt"
base="https://github.com/gitleaks/gitleaks/releases/download/v${gitleaks_version}"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT
cd "$temporary"
curl --fail --silent --show-error --location "$base/$archive" --output "$archive"
curl --fail --silent --show-error --location "$base/$checksums" --output "$checksums"
awk -v archive="$archive" '$2 == archive { print; found=1 } END { if (!found) exit 1 }' "$checksums" | sha256sum --check --strict
tar -xzf "$archive" gitleaks
sudo install -m 0755 gitleaks /usr/local/bin/gitleaks
