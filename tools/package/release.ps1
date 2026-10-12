# Make the update package of this version of Link, and (with -Publish) put it out.
#
#   powershell -File tools\package\release.ps1            build dist\release\link-rwa-N.zip and latest.json, publish nothing
#   powershell -File tools\package\release.ps1 -Publish   the same, then make it the newest release of the updates repository
#
# An installed Link reads latest.json from the newest release when it starts, checks that it is signed
# with Link's key (latest.json.sig, made by sign.py with the key in %USERPROFILE%\.link) and, if its own number
# is lower, downloads the zip, checks it against the SHA-256 in latest.json and puts it in place
# (tools\reels\update.py). The zip is tools\reels as git has it at HEAD: Link's own code, without the
# speech model and without Electron.
#
# The number is the count of commits, the same "rwa-N" Settings > About shows. A release is made
# from what is committed and pushed, so this refuses a working folder with changes in it.
#
# RUNTIME (the file beside this one) is the number of the heavy files an install carries: Python,
# Electron, ffmpeg. Raise it by one, and build and hand out a new Link-Setup.exe, whenever the code
# starts to need newer ones; installs with a lower number are then told to get the new installer
# instead of being given code they cannot run.
#
# The installer is not part of every release (it is 200 MB and changes seldom). It lives under one
# fixed tag, "installer", so that its download address never changes:
#   https://github.com/<repo>/releases/download/installer/Link-Setup.exe
# -Installer puts dist\Link-Setup.exe and dist\Link-Windows.zip there (build them first with build.ps1). An installer that is a
# few versions old is fine: the Link it installs updates itself the first time it starts.
param([switch]$Publish, [switch]$Installer, [string]$Repo = "shushu-eco/link")
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$out = Join-Path $root "dist\release"

if (git -C $root status --porcelain -- tools) { Write-Host "There are changes under tools that are not committed. Commit them first: a release is what git has." -ForegroundColor Red; exit 1 }
git -C $root fetch -q origin
if ((git -C $root rev-parse HEAD) -ne (git -C $root rev-parse origin/main)) { Write-Host "HEAD is not what is on origin/main. Push first, so the number means the same everywhere." -ForegroundColor Red; exit 1 }

$n = [int](git -C $root rev-list --count HEAD).Trim()
$date = (git -C $root log -1 --format="%cs").Trim()
$runtime = [int](Get-Content (Join-Path $PSScriptRoot "RUNTIME") -Raw).Trim()
New-Item -ItemType Directory -Force $out | Out-Null
$zip = Join-Path $out "link-rwa-$n.zip"
git -C $root archive --format=zip -o $zip "HEAD:tools/reels"
$manifest = [ordered]@{
    version = $n; date = $date; runtime = $runtime
    package = "link-rwa-$n.zip"; size = (Get-Item $zip).Length
    sha256 = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    installer = "https://github.com/$Repo/releases/download/installer/Link-Setup.exe"
}
# no BOM: the updater reads this as plain JSON
[IO.File]::WriteAllText((Join-Path $out "latest.json"), ($manifest | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
Write-Host "rwa-$n ($date), runtime $runtime, $([Math]::Round($manifest.size / 1MB, 2)) MB, sha256 $($manifest.sha256)"
Write-Host "-> $zip"
# Signed with Link's own key, which is on this PC alone (tools\package\sign.py): an installed Link takes
# only a release whose latest.json carries this signature.
python (Join-Path $PSScriptRoot "sign.py") (Join-Path $out "latest.json")
if ($LASTEXITCODE -ne 0) { Write-Host "The release was not signed, so it is not put out." -ForegroundColor Red; exit 1 }

if (-not $Publish) { Write-Host "Built only. Run again with -Publish to put it out." ; exit 0 }
# The releases there are already (asked this way, not with "gh release view": that one writes to the error
# stream when there is none, which stops this script).
$tags = @(gh release list --repo $Repo --limit 200 --json tagName --jq ".[].tagName")
if ($tags -contains "rwa-$n") { Write-Host "rwa-$n is published already: left as it is." } else {
gh release create "rwa-$n" $zip (Join-Path $out "latest.json") (Join-Path $out "latest.json.sig") --repo $Repo --title "Link rwa-$n" --notes "Link rwa-$n ($date).`n`n**To install Link, download [Link-Setup.exe](https://github.com/$Repo/releases/download/installer/Link-Setup.exe) or [Link-Windows.zip](https://github.com/$Repo/releases/download/installer/Link-Windows.zip).** The files below are the update package and its signature: copies of Link that are installed already fetch it by themselves when they start, and it does not run on its own." --latest
if ($LASTEXITCODE -ne 0) { Write-Host "The release was not published." -ForegroundColor Red; exit 1 }
Write-Host "Published: installed copies of Link update to rwa-$n at their next start." -ForegroundColor Green
}

if ($Installer) {
    $setup = Join-Path $root "dist\Link-Setup.exe"
    $portable = Join-Path $root "dist\Link-Windows.zip"
    foreach ($f in $setup, $portable) { if (-not (Test-Path $f)) { Write-Host "$f is not there. Build it with tools\package\build.ps1." -ForegroundColor Red; exit 1 } }
    $sums = Join-Path $out "SHA256SUMS.txt"
    [IO.File]::WriteAllText($sums, (($setup, $portable | ForEach-Object { "$((Get-FileHash $_ -Algorithm SHA256).Hash.ToLower())  $(Split-Path $_ -Leaf)" }) -join "`n") + "`n", (New-Object Text.UTF8Encoding $false))
    $about = "Link for Windows 10 and 11 (64-bit), rwa-$n.`n`n- **Link-Setup.exe**: the installer. It puts Link in your user folder with icons on the Desktop, and fetches the speech model.`n- **Link-Windows.zip**: the same program without installing. Unpack it to a folder with a plain name (C:\\Link) and double-click Start Link.`n`nWindows may say ""Windows protected your PC"", because Link is not signed with a paid certificate: press More info, then Run anyway. SHA256SUMS.txt holds the checksums. Download once; Link keeps itself up to date after that."
    # handed over as a file: the quotation marks in it would break it up on its way to gh as an argument
    $aboutFile = Join-Path $out "installer-notes.md"
    [IO.File]::WriteAllText($aboutFile, $about, (New-Object Text.UTF8Encoding $false))
    if ($tags -notcontains "installer") {
        gh release create installer $setup $portable $sums --repo $Repo --title "Link for Windows: installer and zip" --notes-file $aboutFile --latest=false
    } else {
        gh release upload installer $setup $portable $sums --repo $Repo --clobber
        gh release edit installer --repo $Repo --notes-file $aboutFile
    }
    if ($LASTEXITCODE -ne 0) { Write-Host "The installer and the zip were not uploaded." -ForegroundColor Red; exit 1 }
    Write-Host "Installer uploaded: https://github.com/$Repo/releases/download/installer/Link-Setup.exe" -ForegroundColor Green
}
