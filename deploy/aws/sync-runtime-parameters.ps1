param(
  [string]$ConfigPrefix = "/atomic-blast/prod/config",
  [string]$SecretPrefix = "/atomic-blast/prod/secrets"
)

$ErrorActionPreference = "Stop"

function Put-Param {
  param(
    [string]$Name,
    [string]$Value,
    [string]$Type = "String"
  )

  $inputObject = @{
    Name = $Name
    Type = $Type
    Value = $Value
    Overwrite = $true
  }
  $inputJson = $inputObject | ConvertTo-Json -Compress
  $tempFile = New-TemporaryFile
  try {
    Set-Content -LiteralPath $tempFile -Value $inputJson -Encoding UTF8
    aws ssm put-parameter --cli-input-json "file://$tempFile" | Out-Null
  } finally {
    Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
  }
}

$config = @{
  NODE_ENV = "production"
  PORT = "8080"
  PUBLIC_ORIGIN = "https://blast.atomicradius.app"
  B2_BUCKET = "SpAtomify"
  B2_BUCKET_URL = "https://s3.us-east-005.backblazeb2.com/SpAtomify"
  B2_PREFIX = "Music/"
  AUTH_SUPPORT_EMAIL = "adammharvey+AtomicBlast@gmail.com"
  GOOGLE_REDIRECT_URI = "https://blast.atomicradius.app/api/auth/google/callback"
}

foreach ($item in $config.GetEnumerator()) {
  Put-Param -Name "$ConfigPrefix/$($item.Key)" -Value $item.Value
}

$secretNames = @(
  "B2_KEY_ID",
  "B2_APP_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "SPOTIFY_CLIENT_ID",
  "SPOTIFY_CLIENT_SECRET",
  "LASTFM_API_KEY"
)

foreach ($name in $secretNames) {
  $fullName = "$SecretPrefix/$name"
  $existing = aws ssm get-parameter --name $fullName --with-decryption --query "Parameter.Value" --output text 2>$null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "Keeping existing $fullName"
    continue
  }
  Put-Param -Name $fullName -Value "TODO_SET_$name" -Type "SecureString"
  Write-Host "Created placeholder $fullName"
}

Write-Host "AtomicBlast runtime parameters are present under $ConfigPrefix and $SecretPrefix."
