#!/bin/sh
# Install the herdr-app (native app, not the TUI) mods + layout `main-code` into ~/.config/herdr-app.
# usage: herdr-app/install.sh        then: herdr-app do layout.switch --name main-code
set -eu
here=$(cd "$(dirname "$0")" && pwd)
dst=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
mkdir -p "$dst/mods" "$dst/layouts"
for m in "$here"/mods/*/; do cp -r "$m" "$dst/mods/"; done
cp "$here"/layouts/*.json "$dst/layouts/"
for m in "$here"/mods/*/; do herdr-app check "$dst/mods/$(basename "$m")" || true; done
echo "ok. Layout: herdr-app do layout.switch --name main-code ; sidebar: herdr-app do layout.show --id sidebar"
