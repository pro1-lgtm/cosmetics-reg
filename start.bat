@echo off
chcp 65001 >nul
cd /d "%~dp0"
title cosmetics-reg

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo [X] Node.js 가 설치돼 있지 않습니다.
    echo     https://nodejs.org 에서 LTS 버전 설치 후 다시 실행하세요.
    echo.
    pause
    exit /b 1
)

node scripts\launch.cjs

echo.
echo (서버가 종료되었습니다. 아무 키나 눌러 창을 닫습니다.)
pause >nul
