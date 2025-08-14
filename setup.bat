@echo off
echo.
echo ========================================
echo   CapCut Automation Setup (Windows)
echo ========================================
echo.

echo Installing Node.js dependencies...
call npm install

echo Installing FFmpeg npm package (fallback for setup)...
call npm install @ffmpeg-installer/ffmpeg

echo.
echo Running automated setup...
node setup.js

echo.
echo Setup complete! You can now run:
echo   npm start
echo.
pause
