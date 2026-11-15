#!/usr/bin/env bash
# Layout: [ current shell | claude ]
#         [ test shell   |        ]
set -euo pipefail
h="${HERDR_BIN_PATH:-herdr}"
cur="${HERDR_PANE_ID:?needs a pane context}"
pid() { jq -r '.result.pane.pane_id'; }

claude=$("$h" pane split "$cur" --direction right --ratio 0.55 --focus | pid)
"$h" pane run "$claude" "claude"
"$h" pane split "$cur" --direction down --ratio 0.3 --no-focus >/dev/null
"$h" pane rename "$claude" "claude" >/dev/null
