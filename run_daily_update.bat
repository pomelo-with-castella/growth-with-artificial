@echo off
REM 为避免中文编码导致的乱码，这里只保留英文输出
cd /d "%~dp0"

echo [AI Dashboard] Updating news and analysis...
node fetch_news_and_analyze.js
if %ERRORLEVEL% neq 0 (
    echo [AI Dashboard] Update failed. Please check network or .env.
    pause
    exit /b 1
)

echo [AI Dashboard] Update finished. You can refresh the page to see daily_ai_dashboard.json.
pause
exit /b 0
