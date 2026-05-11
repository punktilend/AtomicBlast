$ErrorActionPreference = 'Stop'

$appName = 'AtomicBlast'
$appUrl = 'https://blast.atomicradius.app'
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) "$appName.lnk"

$browser = $null
$candidates = @(
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
)

foreach ($candidate in $candidates) {
  if ($candidate -and (Test-Path $candidate)) {
    $browser = $candidate
    break
  }
}

if (-not $browser) {
  Write-Host 'Microsoft Edge or Google Chrome was not found. Open https://blast.atomicradius.app in Edge or Chrome and use Install app from the browser menu.'
  exit 1
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $browser
$shortcut.Arguments = "--app=$appUrl"
$shortcut.WorkingDirectory = Split-Path $browser
$shortcut.Description = 'Open AtomicBlast as a desktop app'
$shortcut.Save()

Write-Host "AtomicBlast shortcut created: $shortcutPath"
Write-Host 'Open it from your desktop, then pin it to Start or the taskbar.'
