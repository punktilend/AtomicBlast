param(
  [string]$BaseUrl = "https://blast.atomicradius.app"
)

$ErrorActionPreference = "Stop"

$paths = @(
  "/health",
  "/api/auth/config",
  "/manifest.json"
)

foreach ($path in $paths) {
  $uri = "$BaseUrl$path"
  $response = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 30
  Write-Host "$($response.StatusCode) $uri"
}

