@echo off
setlocal

if not "%~1"=="" goto :arguments
    echo Enter hex color (RRGGBB or #RRGGBB):
    set /p HEX=
    echo Enter icon name (e.g. ability_rogue_envelopingshadows):
    set /p OUTPUT=
goto :generate

:arguments
set "OUTPUT=%~1"
set "HEX=%~2"

:generate

powershell -NoProfile -ExecutionPolicy Bypass -Command "$h='%HEX%'.TrimStart('#'); if($h -notmatch '^[0-9a-fA-F]{6}$'){Write-Host 'Invalid hex'; exit 1}; if('%OUTPUT%' -notmatch '^[a-zA-Z0-9_-]+$'){Write-Host 'Invalid icon name'; exit 1}; $r=[Convert]::ToByte($h.Substring(0,2),16); $g=[Convert]::ToByte($h.Substring(2,2),16); $b=[Convert]::ToByte($h.Substring(4,2),16); $hdr=New-Object byte[] 18; $hdr[2]=2; $hdr[12]=1; $hdr[14]=1; $hdr[16]=32; $hdr[17]=32; $px=@($b,$g,$r,255); [IO.File]::WriteAllBytes((Get-Location).Path + '\%OUTPUT%' + '.tga', $hdr + $px)"

if %ERRORLEVEL% NEQ 0 (
    echo Failed to create %OUTPUT%.tga
    set "EXITCODE=%ERRORLEVEL%"
    goto :finish-error
)

echo Created %OUTPUT%.tga
goto :finish

:finish-error
if not "%~1"=="" exit /b %EXITCODE%
pause
exit /b %EXITCODE%

:finish
if not "%~1"=="" exit /b 0
pause