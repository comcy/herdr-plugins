# herdr-claude-layout
Herdr plugin: one action splits the current pane into shell | claude (+ test shell below).

    herdr plugin link ./claude-layout
    herdr plugin action invoke hp.claude-layout.apply

Keybinding (`~/.config/herdr/config.toml`):

    [[keys.command]]
    key = "prefix+l"
    type = "plugin_action"
    command = "hp.claude-layout.apply"
    description = "claude layout"

Needs `jq`. Ratio/command: edit `apply.sh`.
