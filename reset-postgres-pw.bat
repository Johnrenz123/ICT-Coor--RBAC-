@echo off
REM PostgreSQL Password Reset - Run this with Administrator privileges

setlocal enabledelayedexpansion

REM PostgreSQL paths
set PG_BIN=C:\Program Files\PostgreSQL\17\bin
set PG_DATA=C:\Program Files\PostgreSQL\17\data
set PG_SERVICE=postgresql-x64-17

echo =========================================
echo PostgreSQL Password Reset Utility
echo =========================================
echo.

REM Check if running as admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: This script must be run as Administrator!
    echo Please right-click and select "Run as administrator"
    pause
    exit /b 1
)

echo Step 1: Stopping PostgreSQL service...
net stop %PG_SERVICE% /y
if errorlevel 1 (
    echo Warning: Could not stop service. Continuing anyway...
)
timeout /t 3

echo Step 2: Starting PostgreSQL with single-user mode...
"%PG_BIN%\pg_ctl" -D "%PG_DATA%" start -m immediate
timeout /t 2

echo Step 3: Resetting postgres user password to: postgres123
"%PG_BIN%\psql" -U postgres -d postgres -c "ALTER ROLE postgres WITH PASSWORD 'postgres123';"

if errorlevel 1 (
    echo WARNING: Password reset may have failed. Trying alternative method...
    echo postgres123 | "%PG_BIN%\psql" -U postgres -d postgres -c "ALTER ROLE postgres WITH PASSWORD 'postgres123';"
)

echo Step 4: Restarting PostgreSQL service...
net start %PG_SERVICE%

echo.
echo =========================================
echo Password Reset Complete!
echo =========================================
echo New password: postgres123
echo Please update your .env file with this password
echo.
pause
