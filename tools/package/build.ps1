# Builds Link-Setup.exe, the installer that puts Link on a PC with nothing else installed, and
# Link-Windows.zip, the same folder to unpack and start by hand.
#
#   powershell -ExecutionPolicy Bypass -File tools\package\build.ps1 [-Version 1.0.1] [-NoInstaller]
#
# It assembles dist\Link\, a folder shaped like this project (so no path in Link's code changes)
# that also carries what setup.ps1 expects to find on the PC:
#   runtime\python\        Python (python.org's embeddable package) with numpy and opencv
#   runtime\ffmpeg\bin\    ffmpeg and ffprobe (a shared build with the whisper filter)
#   tools\reels\shell\node_modules\   Electron and the ad blocker's packages
# then checks that the folder works by itself, compiles tools\package\link.iss with Inno Setup and
# packs the folder as a zip.
# The speech model is not put in: the installer downloads it.
#
# Needs on this PC: Link set up for development (setup.ps1: Python with pip, npm install done),
# internet for the first build (downloads are kept in dist\cache), and Inno Setup 6
# (winget install JRSoftware.InnoSetup).
param([string]$Version, [switch]$NoInstaller)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # Invoke-WebRequest is many times faster without its bar
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$dist = Join-Path $root "dist"
$stage = Join-Path $dist "Link"
$cache = Join-Path $dist "cache"
$reels = Join-Path $root "tools\reels"
# Link's version is the window's: tools\reels\shell\package.json.
if (-not $Version) { $Version = (Get-Content (Join-Path $reels "shell\package.json") -Raw | ConvertFrom-Json).version }

# PowerShell does not tell capitals from small letters in names: these must differ from $python, $electron below.
$PYTHON_VERSION = "3.14.2"    # the version Link is developed on
$PYTAG = "314"
$ELECTRON_VERSION = "44.5.1"
$FFMPEG_VERSION = "8.1.2"
$FFMPEG_ZIP = "https://github.com/GyanD/codexffmpeg/releases/download/$FFMPEG_VERSION/ffmpeg-$FFMPEG_VERSION-full_build-shared.zip"
$PYTHON_ZIP = "https://www.python.org/ftp/python/$PYTHON_VERSION/python-$PYTHON_VERSION-embed-amd64.zip"
# What the window needs at run time besides Electron itself (the rest of node_modules only installs Electron).
$NODE_PACKAGES = @("@ghostery", "@remusao", "tldts-core", "tldts-experimental")

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "FAILED   $text" -ForegroundColor Red; exit 1 }
function Ok($text) { Write-Host "OK       $text" }
function Fetch($url, $name) {
    $file = Join-Path $cache $name
    if (-not (Test-Path $file)) {
        Write-Host "Downloading $name ..."
        Invoke-WebRequest $url -OutFile "$file.part"
        Move-Item "$file.part" $file
    }
    return $file
}
# Runs a program and gives its output as one text; a program that is not there or fails gives "".
function Out($exe, [string[]]$arguments) {
    try { return ((& $exe @arguments 2>&1) | Out-String) } catch { return "" }
}

Step "1. Link's own files"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force $stage, $cache | Out-Null
# What git has, without what is marked to stay on this PC (export-ignore in .gitattributes).
# (The names are handed over as arguments: piped in, PowerShell ends each with a line end git takes for part of the name.)
$listed = @(git -C $root ls-files "tools/reels")
$kept = (git -C $root check-attr export-ignore -- $listed) | Where-Object { $_ -match ": export-ignore: set$" } | ForEach-Object { $_ -replace ": export-ignore: set$", "" }
$files = $listed | Where-Object { $kept -notcontains $_ }
if (-not $files) { Fail "git lists no files under tools/reels" }
foreach ($f in $files) {
    $to = Join-Path $stage $f
    New-Item -ItemType Directory -Force (Split-Path $to) | Out-Null
    Copy-Item (Join-Path $root $f) $to
}
Ok "$($files.Count) files"

Step "2. The window: Electron $ELECTRON_VERSION and the ad blocker"
$modules = Join-Path $reels "shell\node_modules"
$electron = Join-Path $modules "electron\dist"
if (-not (Test-Path (Join-Path $electron "electron.exe"))) { Fail "Electron is not installed here: run npm install in tools\reels\shell" }
$have = (Get-Content (Join-Path $electron "version") -Raw).Trim()
if ($have -ne $ELECTRON_VERSION) { Fail "Electron here is $have, the build expects $ELECTRON_VERSION" }
$to = Join-Path $stage "tools\reels\shell\node_modules"
robocopy $electron (Join-Path $to "electron\dist") /E /NFL /NDL /NJH /NJS /NP | Out-Null
foreach ($p in $NODE_PACKAGES) { robocopy (Join-Path $modules $p) (Join-Path $to $p) /E /NFL /NDL /NJH /NJS /NP | Out-Null }
# Chromium's menus in other languages: Link's own screens are English. The English one must stay.
Get-ChildItem (Join-Path $to "electron\dist\locales") -Filter *.pak | Where-Object { $_.Name -ne "en-US.pak" } | Remove-Item
foreach ($must in "electron.exe", "resources\default_app.asar", "LICENSE", "LICENSES.chromium.html", "locales\en-US.pak") {
    if (-not (Test-Path (Join-Path $to "electron\dist\$must"))) { Fail "Electron's $must is missing from the copy" }
}
Ok "Electron and $((Get-ChildItem (Join-Path $to '@ghostery'), (Join-Path $to '@remusao') -Directory).Count + 2) packages"

Step "3. Python $PYTHON_VERSION with numpy and opencv"
$python = Join-Path $stage "runtime\python"
Expand-Archive (Fetch $PYTHON_ZIP "python-$PYTHON_VERSION-embed-amd64.zip") $python
# Where this Python looks for modules. It does not add a script's own folder by itself, and Link's
# scripts import each other from theirs (ingest.py -> analyze.py), so that folder is named here.
Set-Content (Join-Path $python "python$PYTAG._pth") -Encoding ascii -Value @("python$PYTAG.zip", ".", "Lib\site-packages", "..\..\tools\reels")
$site = Join-Path $python "Lib\site-packages"
python -m pip install --quiet --disable-pip-version-check --target $site --only-binary=:all: --platform win_amd64 --python-version $PYTHON_VERSION --implementation cp -r (Join-Path $PSScriptRoot "requirements.lock")
if ($LASTEXITCODE -ne 0) { Fail "pip could not install numpy and opencv" }
Remove-Item (Join-Path $site "bin") -Recurse -Force -ErrorAction SilentlyContinue   # numpy's command-line tools, not used
Ok "Python $PYTHON_VERSION"

Step "4. ffmpeg $FFMPEG_VERSION"
$unpacked = Join-Path $cache "ffmpeg-$FFMPEG_VERSION-full_build-shared"
if (-not (Test-Path $unpacked)) { Expand-Archive (Fetch $FFMPEG_ZIP "ffmpeg-$FFMPEG_VERSION-full_build-shared.zip") $cache }
$bin = Join-Path $stage "runtime\ffmpeg\bin"
New-Item -ItemType Directory -Force $bin | Out-Null
Get-ChildItem (Join-Path $unpacked "bin") | Where-Object { $_.Name -ne "ffplay.exe" } | Copy-Item -Destination $bin
Ok "ffmpeg and ffprobe"

Step "5. Licences and the version"
$lic = Join-Path $stage "licenses"
New-Item -ItemType Directory -Force (Join-Path $lic "ffmpeg") | Out-Null
Copy-Item (Join-Path $PSScriptRoot "licenses\*") $lic -Recurse
Copy-Item (Join-Path $unpacked "LICENSE"), (Join-Path $unpacked "README.txt") (Join-Path $lic "ffmpeg")
Copy-Item (Join-Path $root "LICENSE") (Join-Path $lic "LICENSE-Link.txt")   # Link's own: the GNU General Public License, version 3
# What someone who unpacked the zip double-clicks, and what to read first. The installer puts them in too.
Copy-Item (Join-Path $PSScriptRoot "portable\*") $stage
$commit = (git -C $root log -1 --format="%h %cs").Trim()
# "rwa-" and the number of commits: the version Settings > About shows (ui/server.py reads it from this file)
$number = "rwa-" + (git -C $root rev-list --count HEAD).Trim()
Set-Content (Join-Path $stage "VERSION") -Encoding ascii -Value "Link $Version $number ($commit)"
# What the updater goes by (tools\reels\update.py): which heavy files this install carries, and the
# list of Link's own files, so that an update can take away the ones a newer version no longer has.
New-Item -ItemType Directory -Force (Join-Path $stage "update") | Out-Null
Copy-Item (Join-Path $PSScriptRoot "RUNTIME") (Join-Path $stage "update\runtime.txt")   # not beside VERSION: Windows would take the name for the "runtime" folder
$own = $files | ForEach-Object { $_ -replace '^tools/reels/', '' }
Set-Content (Join-Path $stage "update\files.json") -Encoding ascii -Value (ConvertTo-Json @($own) -Compress)
Ok "Link $Version $number ($commit)"

Step "6. Does the folder work by itself?"
# With nothing of this PC's own Python, Node or ffmpeg in reach.
$oldPath = $env:PATH
$env:PATH = "$bin;$env:SystemRoot\System32;$env:SystemRoot"
$py = Join-Path $python "python.exe"
try {
    Push-Location $stage
    if ((Out $py @("-c", "import cv2, numpy, ssl, ctypes, sqlite3; print('modules', numpy.__version__, cv2.__version__)")) -notmatch "modules") { Fail "the bundled Python cannot import its modules" } else { Ok "Python imports numpy, opencv, ssl" }
    if ((Out $py @("tools\reels\ingest.py", "--help")) -notmatch "usage") { Fail "ingest.py does not start (it imports analyze.py from its own folder)" } else { Ok "Link's scripts find each other" }
    if ((Out $py @("tools\reels\build_reels.py", "--help")) -notmatch "usage") { Fail "build_reels.py does not start" } else { Ok "build_reels.py starts" }
    # The server runs jobs with these two set and reads their output as UTF-8, line by line.
    $env:PYTHONIOENCODING = "utf-8"; $env:PYTHONUNBUFFERED = "1"
    $how = Out $py @("-c", "import sys; print(sys.stdout.encoding, sys.stdout.write_through)")
    Remove-Item Env:PYTHONIOENCODING, Env:PYTHONUNBUFFERED
    if ($how -notmatch "utf-8 True") { Fail "job output would not be UTF-8 and unbuffered: $how" } else { Ok "job output is UTF-8 and unbuffered" }
    $filters = Out "ffmpeg" @("-hide_banner", "-filters")
    foreach ($f in "whisper", "ass", "loudnorm", "boxblur", "aresample") { if ($filters -notmatch "\s$f\s") { Fail "ffmpeg has no '$f' filter" } }
    $encoders = Out "ffmpeg" @("-hide_banner", "-encoders")
    foreach ($e in "libx264", "h264_nvenc", "aac") { if ($encoders -notmatch "\s$e\s") { Fail "ffmpeg has no '$e' encoder" } }
    if ((Out "ffprobe" @("-version")) -notmatch "ffprobe version") { Fail "ffprobe does not run" }
    $render = Out "ffmpeg" @("-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=1:size=320x180:rate=30", "-c:v", "libx264", "-f", "null", "-")
    if ($LASTEXITCODE -ne 0) { Fail "ffmpeg could not encode a test picture: $render" }
    Ok "ffmpeg has whisper, ass, loudnorm, libx264, nvenc, aac; ffprobe runs"
    # The server itself, on a port of its own so a running Link is not disturbed.
    $server = Start-Process $py -ArgumentList "tools\reels\ui\server.py", "--port", "8799" -WorkingDirectory $stage -PassThru -WindowStyle Hidden
    $answer = $null
    foreach ($try in 1..40) { Start-Sleep -Milliseconds 500; try { $answer = Invoke-RestMethod "http://127.0.0.1:8799/api/status" -TimeoutSec 2; break } catch { } }
    $tapes = if ($answer) { (Invoke-RestMethod "http://127.0.0.1:8799/api/sources").Count } else { $null }
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    if (-not $answer) { Fail "the server did not answer" } else { Ok "the server starts and answers ($tapes tapes: a fresh install has none)" }
} finally {
    Pop-Location
    $env:PATH = $oldPath
}
# What the checks left behind is not part of the program.
Get-ChildItem $stage -Recurse -Directory -Filter "__pycache__" | Remove-Item -Recurse -Force
foreach ($made in "videos", "strategy") { Remove-Item (Join-Path $stage $made) -Recurse -Force -ErrorAction SilentlyContinue }
$size = [math]::Round((Get-ChildItem $stage -Recurse -File | Measure-Object Length -Sum).Sum / 1MB)
Ok "dist\Link is ready: $size MB"

if ($NoInstaller) { exit 0 }

Step "7. The installer"
$iscc = @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { Fail "Inno Setup 6 is not installed (winget install JRSoftware.InnoSetup). dist\Link is built; run this again afterwards." }
& $iscc /Qp "/DAppVersion=$Version" "/DStage=$stage" "/O$dist" (Join-Path $PSScriptRoot "link.iss")
if ($LASTEXITCODE -ne 0) { Fail "Inno Setup could not build the installer" }
$setup = Get-Item (Join-Path $dist "Link-Setup.exe")
Ok "$($setup.FullName): $([math]::Round($setup.Length / 1MB)) MB"
Write-Host "SHA-256  $((Get-FileHash $setup.FullName -Algorithm SHA256).Hash.ToLower())"

Step "8. The zip"
# The same folder, as "Link\..." inside the zip. Windows' own tar writes zips; the one Git brings does not.
$zip = Join-Path $dist "Link-Windows.zip"
if (Test-Path $zip) { Remove-Item $zip }
& "$env:SystemRoot\System32\tar.exe" -a -c -f $zip -C $dist "Link"
if ($LASTEXITCODE -ne 0) { Fail "the zip could not be made" }
Ok "$zip`: $([math]::Round((Get-Item $zip).Length / 1MB)) MB"
Write-Host "SHA-256  $((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower())"
