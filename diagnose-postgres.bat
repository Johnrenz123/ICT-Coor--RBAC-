@echo off
REM Try to reset PostgreSQL postgres user password using Windows postgres service account

REM First, let's get information about PostgreSQL installation
echo Checking PostgreSQL installation...

REM Try to find pg_ctl
where /q "C:\Program Files\PostgreSQL\17\bin\pg_ctl" 
if %errorlevel% equ 0 (
    echo ✓ pg_ctl found
) else (
    echo ✗ pg_ctl not found
    exit /b 1
)

REM Show the postgres user's home directory
echo.
echo Current postgres user: %USERNAME%
echo Postgres Data Directory: C:\Program Files\PostgreSQL\17\data

REM List files in data directory  
echo.
echo Files in pg_data\global\:
dir "C:\Program Files\PostgreSQL\17\data\global" 2>nul | find "pg_authid"

REM Try to create a recovery command file
echo.
echo Creating recovery configuration file...
echo recovery_target_timeline = 'latest' > "C:\Program Files\PostgreSQL\17\data\recovery.conf"

echo Done. You may need to restart PostgreSQL for changes to take effect.
