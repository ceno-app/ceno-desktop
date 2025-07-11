# Portable installer inspired by Tor Browser portable installer
# https://gitlab.torproject.org/tpo/applications/tor-browser-build/-/tree/maint-14.5/projects/browser/windows-installer?ref_type=heads

!include "MUI.nsh"

!include branding.nsi
!include defines.nsi
!include WinVer.nsh
!include "x64.nsh"

SetCompressor /SOLID lzma
SetCompressorDictSize 128

Name "${BrandFullName}"

; Do not require elevated privileges.
; Even for the installer, we install only for the current user, so we do not
; need high privileges.
RequestExecutionLevel user

Unicode true
ManifestDPIAware true

BrandingText "${BrandFullName} ${BASE_BROWSER_VERSION}"
VIAddVersionKey "FileDescription" "${BrandFullName} Portable Installer"

!define MUI_ICON "portable-setup.ico"
!define MUI_ABORTWARNING

!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "wizHeader.bmp"
!define MUI_HEADERIMAGE_BITMAP_RTL "wizHeaderRTL.bmp"
!define MUI_WELCOMEFINISHPAGE_BITMAP "wizWatermark.bmp"

!define MUI_FINISHPAGE_NOREBOOTSUPPORT ; Reboot not required

;--------------------------------
; Reserve Files
; If you are using solid compression, files that are required before
; the actual installation should be stored first in the data block,
; because this will make your installer start faster.
!insertmacro MUI_RESERVEFILE_LANGDLL

;--------------------------------
; Helper functions
Function CheckRequirements
  ; Don't install on systems that don't support SSE2. The parameter value of
  ; 10 is for PF_XMMI64_INSTRUCTIONS_AVAILABLE which will check whether the
  ; SSE2 instruction set is available. Result returned in $R7.
  System::Call "kernel32::IsProcessorFeaturePresent(i 10)i .R7"

  ; Windows 8.1/Server 2012 R2 and lower are not supported.
  ${IfNot} ${AtLeastWin10}
    ${If} "$R7" == "0"
      strCpy $R7 "$(WARN_MIN_SUPPORTED_OSVER_CPU_MSG)"
    ${Else}
      strCpy $R7 "$(WARN_MIN_SUPPORTED_OSVER_MSG)"
    ${EndIf}
    MessageBox MB_OKCANCEL|MB_ICONSTOP "$R7" IDCANCEL +2
    ExecShell "open" "${URLSystemRequirements}"
    Quit
  ${EndUnless}

  ${If} "$R7" == "0"
    MessageBox MB_OKCANCEL|MB_ICONSTOP "$(WARN_MIN_SUPPORTED_CPU_MSG)" IDCANCEL +2
    ExecShell "open" "${URLSystemRequirements}"
    Quit
  ${EndIf}

  ${IfNot} ${IsNativeAMD64}
    MessageBox MB_OKCANCEL|MB_ICONSTOP "$(WARN_MIN_SUPPORTED_OSVER_MSG)" IDCANCEL +2
    ExecShell "open" "${URLSystemRequirements}"
    Quit
  ${EndIf}
FunctionEnd

Function CheckIfTargetDirectoryExists
  ${If} ${FileExists} "$INSTDIR\*.*"
    MessageBox MB_YESNO "$(destination_exists)" IDYES +2
    Abort
  ${EndIf}
FunctionEnd

OutFile "setup-portable.exe"
InstallDir "$DESKTOP\${BrandFullName}"

;--------------------------------
; Pages
; Misuse the option to show the readme to create the shortcuts.
; Less ugly than MUI_PAGE_COMPONENTS.
!define MUI_FINISHPAGE_RUN "$INSTDIR/${FileMainEXE}"
!define MUI_FINISHPAGE_SHOWREADME
!define MUI_FINISHPAGE_SHOWREADME_TEXT "$(add_shortcuts)"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION "CreateShortcuts"

!define MUI_PAGE_CUSTOMFUNCTION_LEAVE CheckIfTargetDirectoryExists
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

; Languages must be defined after pages
!include "languages.nsh"

Function .onInit
  Call CheckRequirements
  !insertmacro MUI_LANGDLL_DISPLAY
FunctionEnd

Section "Browser" SecBrowser
    SetOutPath "$INSTDIR"
    File /r "${PROGRAM_SOURCE}\*"
SectionEnd

Function CreateShortcuts
  CreateShortCut "$SMPROGRAMS\${BrandFullName}.lnk" "$INSTDIR\${FileMainEXE}"
  CreateShortCut "$DESKTOP\${BrandFullName}.lnk" "$INSTDIR\${FileMainEXE}"
FunctionEnd
