; Link-Setup.exe: puts Link on a PC that has nothing else installed. Compiled by build.ps1, which
; passes the version and the folder it assembled:  ISCC /DAppVersion=1.0.0 /DStage=...\dist\Link link.iss
;
; The installed folder has the project's own shape (tools\reels\..., with runtime\ beside it), so
; Link finds everything where it does on a development PC. Tapes, reels and post texts live in
; videos\ and strategy\ inside it: neither an update nor an uninstall touches those, nor the
; settings and sign-ins in %USERPROFILE%\.link.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef Stage
  #define Stage "..\..\dist\Link"
#endif
#define ModelUrl "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"
#define ModelSha "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b"
#define ModelFile "{app}\tools\reels\models\ggml-small.bin"

[Setup]
AppId={{135B9BB6-0BDB-404E-9B91-5A69D0E62D40}
AppName=Link
AppVersion={#AppVersion}
AppVerName=Link {#AppVersion}
AppPublisher=Link
AppPublisherURL=https://github.com/shushu-eco/link
VersionInfoVersion={#AppVersion}
; No administrator prompt: everything goes into the user's own folder.
PrivilegesRequired=lowest
DefaultDirName={code:DefaultDir}
UsePreviousAppDir=yes
DisableProgramGroupPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
; link.pyw holds this for as long as Link runs: Setup and the uninstaller ask to close Link first.
AppMutex=LinkRunning
SetupIconFile={#Stage}\tools\reels\ui\static\link_desktop.ico
UninstallDisplayIcon={app}\tools\reels\ui\static\link_desktop.ico
UninstallDisplayName=Link
WizardStyle=modern
Compression=lzma2/ultra64
SolidCompression=yes
LZMAUseSeparateProcess=yes
OutputBaseFilename=Link-Setup

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Desktop shortcut"; GroupDescription: "Shortcuts:"

[Dirs]
Name: "{app}\videos"; Flags: uninsneveruninstall
Name: "{app}\strategy"; Flags: uninsneveruninstall

[InstallDelete]
; An update replaces the programs Link carries as a whole, so nothing of an older version stays behind.
Type: filesandordirs; Name: "{app}\runtime"
Type: filesandordirs; Name: "{app}\tools\reels\shell\node_modules"

[Files]
Source: "{#Stage}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
; The speech model, downloaded by the page below. Link needs it; if the download failed, "Get speech model" in Link's folder fetches it.
Source: "{tmp}\ggml-small.bin"; DestDir: "{app}\tools\reels\models"; Flags: external skipifsourcedoesntexist

[Icons]
Name: "{autoprograms}\Link"; Filename: "{app}\runtime\python\pythonw.exe"; Parameters: """{app}\tools\reels\link.pyw"""; WorkingDir: "{app}"; IconFilename: "{app}\tools\reels\ui\static\link_desktop.ico"; AppUserModelID: "Link"
Name: "{autodesktop}\Link"; Filename: "{app}\runtime\python\pythonw.exe"; Parameters: """{app}\tools\reels\link.pyw"""; WorkingDir: "{app}"; IconFilename: "{app}\tools\reels\ui\static\link_desktop.ico"; AppUserModelID: "Link"; Tasks: desktopicon
Name: "{autoprograms}\Link (get the speech model)"; Filename: "{app}\Get speech model.cmd"; WorkingDir: "{app}"
; The Updater: a small window that shows which version Link is and brings it up to date (tools\reels\updater)
Name: "{autoprograms}\Link Updater"; Filename: "{app}\tools\reels\shell\node_modules\electron\dist\electron.exe"; Parameters: """{app}\tools\reels\updater"""; WorkingDir: "{app}"; IconFilename: "{app}\tools\reels\ui\static\link_updater.ico"; AppUserModelID: "LinkUpdater"
Name: "{autodesktop}\Link Updater"; Filename: "{app}\tools\reels\shell\node_modules\electron\dist\electron.exe"; Parameters: """{app}\tools\reels\updater"""; WorkingDir: "{app}"; IconFilename: "{app}\tools\reels\ui\static\link_updater.ico"; AppUserModelID: "LinkUpdater"; Tasks: desktopicon

[Run]
Filename: "{app}\runtime\python\pythonw.exe"; Parameters: """{app}\tools\reels\link.pyw"""; WorkingDir: "{app}"; Description: "Start Link"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; The program, with what it wrote while running (Python's caches, the speech model). Not videos\, strategy\.
Type: filesandordirs; Name: "{app}\tools"
Type: filesandordirs; Name: "{app}\runtime"
Type: filesandordirs; Name: "{app}\licenses"

[Code]
var
  DownloadPage: TDownloadWizardPage;

{ OpenCV and ffmpeg's speech filter are unreliable with a folder whose name has an apostrophe or
  letters outside English, which a Windows user name can have. }
function PlainPath(S: String): Boolean;
var
  I: Integer;
begin
  Result := S <> '';
  for I := 1 to Length(S) do
    if (Ord(S[I]) > 126) or (S[I] = '''') then
      Result := False;
end;

function DefaultDir(Param: String): String;
var
  Home: String;
begin
  Home := GetEnv('USERPROFILE');
  if PlainPath(Home) then
    Result := Home + '\Link'
  else
    Result := ExpandConstant('{sd}\Link');
end;

procedure InitializeWizard;
begin
  DownloadPage := CreateDownloadPage('Getting the speech model',
    'Link writes captions from what is said in a video with it. 466 MB, once.', nil);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID = wpReady)
     and not FileExists(ExpandConstant('{#ModelFile}')) then
  begin
    DownloadPage.Clear;
    DownloadPage.Add('{#ModelUrl}', 'ggml-small.bin', '{#ModelSha}');
    DownloadPage.Show;
    try
      try
        DownloadPage.Download;
      except
        { Link is installed all the same, and the model is fetched afterwards. }
        DeleteFile(ExpandConstant('{tmp}\ggml-small.bin'));
        SuppressibleMsgBox('The speech model could not be downloaded.' + #13#10 + #13#10
          + 'Link will be installed, but it needs the model for captions. With the internet on, open '
          + '"Link (get the speech model)" in the Start menu, or "Get speech model" in Link''s folder.', mbInformation, MB_OK, IDOK);
      end;
    finally
      DownloadPage.Hide;
    end;
  end;
end;
