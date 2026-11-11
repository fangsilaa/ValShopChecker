# Build locally, upload to an Ubuntu server, and (re)start the bot.
# Usage:  .\deploy.ps1 -Server ubuntu@<ip>      (or set $env:VALSHOP_SERVER once)
#         .\deploy.ps1 -Server ubuntu@<ip> -Key C:\path\to\key
# The first deploy also uploads your local .env.
param(
  [string]$Server = $env:VALSHOP_SERVER,
  [string]$Key = "$HOME\.ssh\id_ed25519"
)
$ErrorActionPreference = 'Stop'
if (-not $Server) { throw 'No server given. Use: .\deploy.ps1 -Server ubuntu@<ip>   or set $env:VALSHOP_SERVER' }
$Remote = '/home/ubuntu/valshoptracker'

npm run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }

ssh -i $Key $Server "mkdir -p $Remote/deploy && rm -rf $Remote/dist"
scp -i $Key -r dist package.json package-lock.json "${Server}:$Remote/"
scp -i $Key deploy/valshop.service deploy/setup-server.sh "${Server}:$Remote/deploy/"

# Upload .env only if the server doesn't have one yet (so server-side edits aren't overwritten)
ssh -i $Key $Server "test -f $Remote/.env"
if ($LASTEXITCODE -ne 0) {
  Write-Host '>> Uploading .env (first deploy)'
  scp -i $Key .env "${Server}:$Remote/.env"
  ssh -i $Key $Server "chmod 600 $Remote/.env"
}

ssh -i $Key $Server "sed -i 's/\r$//' $Remote/deploy/setup-server.sh && bash $Remote/deploy/setup-server.sh"
