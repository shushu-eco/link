# Sets Link up on this PC: checks the programs it needs, installs its parts and puts a Link icon
# on the Desktop.
#
#   powershell -ExecutionPolicy Bypass -File setup.ps1 [-Model] [-ShortcutPath <file.lnk>] [-NoShortcut]
#
#   -Model         also download the speech model (470 MB) that lets Link read what is said
#   -ShortcutPath  where to put the icon (default: Link.lnk on the Desktop)
#   -NoShortcut    do not make an icon
param([switch]$Model, [string]$ShortcutPath, [switch]$NoShortcut)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$missing = $false

function Need($program, $where) {
    if (Get-Command $program -ErrorAction SilentlyContinue) { Write-Host "OK       $program" }
    else { Write-Host "MISSING  $program  ->  $where"; $script:missing = $true }
}

Write-Host "Checking what Link needs..."
Need python "https://www.python.org/downloads/ (3.12 or newer, tick 'Add python.exe to PATH')"
Need ffmpeg "https://www.gyan.dev/ffmpeg/builds/ (a full build, with its bin folder on the PATH)"
Need node   "https://nodejs.org/ (20 or newer)"
Need npm    "comes with Node.js"
if ($missing) { Write-Host "`nInstall what is missing, open a new PowerShell window and run this script again."; exit 1 }

python -c "import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)"
if ($LASTEXITCODE -ne 0) { Write-Host "Python is older than 3.12. Install a newer one and run this script again."; exit 1 }
if (-not (ffmpeg -hide_banner -loglevel quiet -filters | Select-String -Quiet "\bwhisper\b")) {
    Write-Host "NOTE     this ffmpeg has no 'whisper' filter: Link will work, but without transcripts. A full build has it."
}

Write-Host "`nInstalling the Python packages..."
python -m pip install --quiet -r (Join-Path $root "requirements.txt")
if ($LASTEXITCODE -ne 0) { Write-Host "pip could not install the packages."; exit 1 }

Write-Host "Installing Link's window (Electron, about 390 MB)..."
$shell = Join-Path $root "tools\reels\shell"
Push-Location $shell
try {
    npm install --no-fund --no-audit --loglevel=error
    if ($LASTEXITCODE -ne 0) { Write-Host "npm install failed."; exit 1 }
    # npm sometimes skips the download of Electron's own program file; its install script fetches it.
    # A dropped connection on that 100 MB download is common, so it gets three tries.
    for ($try = 1; $try -le 3 -and -not (Test-Path "node_modules\electron\dist\electron.exe"); $try++) {
        if ($try -gt 1) { Write-Host "The download broke off. Trying again ($try of 3)..."; Start-Sleep -Seconds 3 }
        node "node_modules\electron\install.js"
    }
    if (-not (Test-Path "node_modules\electron\dist\electron.exe")) {
        Write-Host "Electron's program file could not be downloaded. Check the internet connection and run this script again."; exit 1
    }
} finally { Pop-Location }

$modelFile = Join-Path $root "tools\reels\models\ggml-small.bin"
if (Test-Path $modelFile) { Write-Host "The speech model is already there." }
elseif ($Model) {
    Write-Host "Downloading the speech model (470 MB)..."
    New-Item -ItemType Directory -Force (Split-Path $modelFile) | Out-Null
    $ProgressPreference = "SilentlyContinue"   # the progress bar makes the download many times slower
    Invoke-WebRequest "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin" -OutFile "$modelFile.part"
    Move-Item "$modelFile.part" $modelFile -Force
} else { Write-Host "No speech model: Link will not read what is said. Run this script with -Model to add it." }

if (-not $NoShortcut) {
    if (-not $ShortcutPath) { $ShortcutPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "Link.lnk" }
    # pythonw runs the launcher without a console window.
    $pythonw = python -c "import sys, pathlib; print(pathlib.Path(sys.executable).with_name('pythonw.exe'))"
    $link = (New-Object -ComObject WScript.Shell).CreateShortcut($ShortcutPath)
    $link.TargetPath = $pythonw
    $link.Arguments = '"' + (Join-Path $root "tools\reels\link.pyw") + '"'
    $link.WorkingDirectory = $root
    $link.IconLocation = (Join-Path $root "tools\reels\ui\static\link_desktop.ico")
    $link.Description = "Link: video to reels"
    $link.Save()
    Write-Host "Icon made: $ShortcutPath"
}

Write-Host "`nDone. Start Link from its icon, or with:  pythonw tools\reels\link.pyw"
