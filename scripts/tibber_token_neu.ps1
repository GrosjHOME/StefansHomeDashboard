# Neuen Tibber-Refresh-Token erzeugen (fuer den ID.3-Poller auf Val Town).
#
# Ausfuehren:  powershell -ExecutionPolicy Bypass -File scripts\tibber_token_neu.ps1
#
# Ablauf: Client-ID + Client-Secret eingeben -> Browser oeffnet die Tibber-Anmeldung ->
# nach dem Zustimmen landet der Browser auf "localhost" (Seite nicht erreichbar - das ist
# richtig) -> die komplette Adresse aus der Adresszeile hier einfuegen. Der Token kommt in
# die Zwischenablage (wird nicht angezeigt) und gehoert in Val Town in die
# Umgebungsvariable TIBBER_REFRESH_TOKEN. Nirgends sonst speichern - er wird ohnehin bei
# jedem Lauf durch einen neuen ersetzt (Einmal-Tokens).

$ErrorActionPreference = 'Stop'
$redirect = 'http://localhost:8123/callback'
$scope    = 'openid profile email offline_access data-api-user-read data-api-homes-read data-api-vehicles-read'

$clientId = (Read-Host 'Tibber Client-ID').Trim()
$secure   = Read-Host 'Tibber Client-Secret' -AsSecureString
$clientSecret = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))

$state = [guid]::NewGuid().ToString('N')
$url = 'https://thewall.tibber.com/connect/authorize?response_type=code' +
       '&client_id='    + [uri]::EscapeDataString($clientId) +
       '&redirect_uri=' + [uri]::EscapeDataString($redirect) +
       '&scope='        + [uri]::EscapeDataString($scope) +
       '&state='        + $state

Write-Host ''
Write-Host 'Der Browser oeffnet sich: bei Tibber anmelden und zustimmen.'
Write-Host 'Danach zeigt er "localhost - Seite nicht erreichbar". Das ist richtig.'
Write-Host 'Die KOMPLETTE Adresse aus der Adresszeile kopieren und hier einfuegen.'
Write-Host ''
Start-Process $url
$back = (Read-Host 'Adresse (http://localhost:8123/callback?code=...)').Trim()

if ($back -notmatch '[?&]code=([^&]+)') { throw 'Kein "code" in der Adresse gefunden - bitte nochmal starten.' }
$code = [uri]::UnescapeDataString($Matches[1])
if (($back -match '[?&]state=([^&]+)') -and ($Matches[1] -ne $state)) { throw '"state" passt nicht - bitte nochmal starten.' }

$tok = Invoke-RestMethod -Method Post -Uri 'https://thewall.tibber.com/connect/token' `
  -ContentType 'application/x-www-form-urlencoded' `
  -Body @{ grant_type = 'authorization_code'; code = $code; redirect_uri = $redirect;
           client_id = $clientId; client_secret = $clientSecret }
if (-not $tok.refresh_token) { throw 'Kein refresh_token erhalten (Scope offline_access fehlt?).' }

Set-Clipboard -Value $tok.refresh_token
Write-Host ''
Write-Host 'OK: neuer Refresh-Token ist in der Zwischenablage.' -ForegroundColor Green
Write-Host '-> In Val Town als TIBBER_REFRESH_TOKEN einfuegen (Val-Seitenleiste, Environment variables).'
Write-Host ''
Read-Host 'Enter zum Beenden'
