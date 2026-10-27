# Renders tools/icon.html to the PNG icons with headless Microsoft Edge.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$source = 'file:///' + ((Join-Path $root 'tools\icon.html') -replace '\\', '/')
$profile = Join-Path $env:TEMP "chess_trainer_icons_$PID"
foreach ($icon in @(@{ Name = 'icon-512.png'; Size = 512 }, @{ Name = 'icon-192.png'; Size = 192 }, @{ Name = 'apple-touch-icon.png'; Size = 180 })) {
    $out = Join-Path $root "icons\$($icon.Name)"
    $size = $icon.Size
    Start-Process -FilePath $edge -Wait -WindowStyle Hidden -ArgumentList @(
        '--headless=new', '--disable-gpu', '--hide-scrollbars', "--user-data-dir=`"$profile`"",
        "--window-size=$size,$size", "--screenshot=`"$out`"", $source)
    if (-not (Test-Path $out)) { throw "Edge did not write $out" }
}
Remove-Item -Recurse -Force $profile -ErrorAction SilentlyContinue
Get-ChildItem (Join-Path $root 'icons') | Select-Object Name, Length
