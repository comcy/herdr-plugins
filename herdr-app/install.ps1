# Install the herdr-app mods + layout `main-code` into the app home (Windows / PowerShell).
# usage: powershell -ExecutionPolicy Bypass -File herdr-app\install.ps1
#        then: herdr-app do layout.switch --name main-code
# App home: $env:HERDR_APP_HOME, else ~\.config\herdr-app (as documented by herdr-app; verify with `herdr-app status`).
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$dst = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { Join-Path $HOME '.config\herdr-app' }
New-Item -ItemType Directory -Force (Join-Path $dst 'mods'), (Join-Path $dst 'layouts') | Out-Null
Copy-Item (Join-Path $here 'mods\*') (Join-Path $dst 'mods') -Recurse -Force
Copy-Item (Join-Path $here 'layouts\*.json') (Join-Path $dst 'layouts') -Force
Get-ChildItem (Join-Path $here 'mods') -Directory | ForEach-Object { herdr-app check (Join-Path $dst "mods\$($_.Name)") }
Write-Host "ok. Layout: herdr-app do layout.switch --name main-code"
