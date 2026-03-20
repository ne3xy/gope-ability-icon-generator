@echo off
setlocal

echo Enter hex color (RRGGBB or #RRGGBB):
set /p HEX=

echo Enter icon name (e.g. ability_rogue_envelopingshadows):
set /p OUTPUT=

powershell -NoProfile -ExecutionPolicy Bypass -Command "$h='%HEX%'.TrimStart('#'); if($h.Length -ne 6){Write-Host 'Invalid hex'; exit 1}; $r=[Convert]::ToByte($h.Substring(0,2),16); $g=[Convert]::ToByte($h.Substring(2,2),16); $b=[Convert]::ToByte($h.Substring(4,2),16); $hdr=New-Object byte[] 18; $hdr[2]=2; $hdr[12]=1; $hdr[14]=1; $hdr[16]=32; $hdr[17]=32; $px=@($b,$g,$r,255); [IO.File]::WriteAllBytes((Get-Location).Path + '\%OUTPUT%' + '.tga', $hdr + $px)"

if %ERRORLEVEL% NEQ 0 (
    echo Failed to create %OUTPUT%.tga
    pause
    exit /b %ERRORLEVEL%
)

echo Created %OUTPUT%.tga
pause