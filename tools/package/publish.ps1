# Put this version of Link into its public repository, as one commit on top of what is there.
#
#   powershell -File tools\package\publish.ps1 -Message "What changed"          make the commit in dist\public, push nothing
#   powershell -File tools\package\publish.ps1 -Message "What changed" -Push    the same, then push it
#
# Link is developed in a private repository; its history there carries the owner's own e-mail address
# and notes that are not part of the software. The public repository (github.com/shushu-eco/link) gets
# the files only: everything git has at HEAD except what .gitattributes marks "export-ignore", committed
# under GitHub's no-reply address. So the public history is one commit for each time this is run.
#
# It refuses a working folder with changes in it (what is published is what is committed), and it
# refuses to go on when a file to be published holds something that must not leave this PC: the words
# to look for are in private-words.txt beside this script, one pattern on a line, which is itself never
# published (so the public copy of this script has no such list and checks nothing).
param([Parameter(Mandatory = $true)][string]$Message, [switch]$Push, [string]$Repo = "shushu-eco/link",
      [string]$Name = "shushu-eco", [string]$Email = "shushu-eco@users.noreply.github.com",
      [string]$Forbidden)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
function Fail($text) { Write-Host "STOP  $text" -ForegroundColor Red; exit 1 }
# "Must": a git command that has to work. (Not named Git: PowerShell would take the "git" inside it for itself.)
function Must { & git.exe @args; if ($LASTEXITCODE -ne 0) { Fail "git $($args -join ' ') failed" } }

if (git -C $root status --porcelain --untracked-files=no) { Fail "there are uncommitted changes; commit them first" }

$dist = Join-Path $root "dist"
$work = Join-Path $dist "public"
$tar = Join-Path $dist "public.tar"
New-Item -ItemType Directory -Force $dist | Out-Null
if (-not (Test-Path (Join-Path $work ".git"))) {
    if (Test-Path $work) { Remove-Item -Recurse -Force $work }
    & git clone --quiet "https://github.com/$Repo.git" $work
    if ($LASTEXITCODE -ne 0) { Fail "could not clone $Repo" }
} else {
    Must -C $work fetch --quiet origin
    if (git -C $work rev-parse --verify --quiet origin/main) { Must -C $work reset --quiet --hard origin/main }
}
Must -C $work checkout --quiet -B main

# the files: out with the old ones, in with HEAD's
Get-ChildItem -Force $work | Where-Object { $_.Name -ne ".git" } | Remove-Item -Recurse -Force
Must -C $root archive --format=tar -o $tar HEAD
& "$env:SystemRoot\System32\tar.exe" -xf $tar -C $work   # Windows' own tar: the one Git brings takes "C:" for another computer
if ($LASTEXITCODE -ne 0) { Fail "could not unpack the files" }
Remove-Item $tar

$words = Join-Path $PSScriptRoot "private-words.txt"
if (-not $Forbidden -and (Test-Path $words)) { $Forbidden = ((Get-Content $words | Where-Object { $_ -and -not $_.StartsWith("#") }) -join "|") }
$found = if (-not $Forbidden) { $null } else { Get-ChildItem -Recurse -File $work | Where-Object { $_.FullName -notmatch "\\\.git\\" -and $_.Length -lt 2MB } |
    Select-String -Pattern $Forbidden -List }
if ($found) { $found | ForEach-Object { Write-Host "      $($_.Path.Substring($work.Length + 1)):$($_.LineNumber)" }; Fail "these files hold something that must not be published" }

Must -C $work add -A
if (git -C $work status --porcelain) {
    Must -C $work -c "user.name=$Name" -c "user.email=$Email" commit --quiet -m $Message
    Write-Host "Committed in dist\public:"
} else { Write-Host "No file changed since the last commit made here:" }   # one made without -Push still waits to be pushed
git -C $work log -1 --format="  %h  %an <%ae>  %s"
git -C $work show --stat --format= HEAD | Select-Object -Last 1

if ($Push) { Must -C $work push --quiet origin main; Write-Host "Pushed to https://github.com/$Repo" }
else { Write-Host "Not pushed. Look at dist\public, then run again with -Push." }
