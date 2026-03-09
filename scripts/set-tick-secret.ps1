param(
  [string]$Secret
)

function New-TickSecret {
  $bytes = New-Object byte[] 48
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return [Convert]::ToBase64String($bytes)
}

function Upsert-EnvValue {
  param(
    [string]$Path,
    [string]$Key,
    [string]$Value
  )

  if (Test-Path $Path) {
    $raw = Get-Content -Raw $Path
  } else {
    $raw = ""
  }

  $line = "$Key=$Value"
  if ($raw -match "(?m)^$Key=") {
    $updated = [Regex]::Replace($raw, "(?m)^$Key=.*$", $line)
  } else {
    $trimmed = $raw.TrimEnd("`r", "`n")
    if ([string]::IsNullOrEmpty($trimmed)) {
      $updated = "$line`r`n"
    } else {
      $updated = "$trimmed`r`n$line`r`n"
    }
  }

  Set-Content -Path $Path -Value $updated
}

if ([string]::IsNullOrWhiteSpace($Secret)) {
  $Secret = New-TickSecret
}

$rootEnv = ".env.local"
$edgeEnv = "supabase/functions/.env.local"

Upsert-EnvValue -Path $rootEnv -Key "TICK_FUNCTION_SECRET" -Value $Secret
Upsert-EnvValue -Path $edgeEnv -Key "TICK_FUNCTION_SECRET" -Value $Secret

Write-Host "Set TICK_FUNCTION_SECRET in:"
Write-Host " - $rootEnv"
Write-Host " - $edgeEnv"
Write-Host ""
Write-Host "Run one of these in your database:"
Write-Host "Hosted (recommended):"
Write-Host "select vault.create_secret('$Secret', 'edge_function_tick_secret', 'Tick header secret for invoke_edge_function');"
Write-Host ""
Write-Host "Local fallback:"
Write-Host "ALTER DATABASE postgres SET app.settings.edge_function_tick_secret = '$Secret';"
