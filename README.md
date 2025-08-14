# CapCut Online Automation

Automated YouTube video processing pipeline that downloads videos and processes them through CapCut's online editor with background removal and effects.

## 🚀 Quick Setup

### Windows (Recommended)
```powershell
# Clone the repository
git clone https://github.com/mustapharajaa/capcut-online-automation.git
cd capcut-online-automation

# Run automated setup
.\setup.bat

# If FFmpeg installation fails, fix the path:
powershell -Command "(Get-Content .env) -replace 'FFMPEG_PATH=.*bin\\ffmpeg\\ffmpeg.exe', 'FFMPEG_PATH=' + (Get-ChildItem node_modules\@ffmpeg-installer\win32-x64\ffmpeg.exe).FullName | Set-Content .env"

# Start the server
npm start
```

### Linux/VPS
```bash
git clone https://github.com/mustapharajaa/capcut-online-automation.git
cd capcut-online-automation
chmod +x setup.sh
./setup.sh
npm start
```

### Manual Setup
```bash
git clone https://github.com/mustapharajaa/capcut-online-automation.git
cd capcut-online-automation
npm install
node setup.js
npm start
```

## ✨ Features

- **YouTube Video Downloader**: Download videos in up to 1080p quality
- **CapCut Automation**: Automated video processing with background removal
- **Real-time Progress**: Live progress updates via web interface
- **Multi-editor Support**: Manage multiple CapCut editor instances
- **File Management**: Organized video storage and status tracking
- **Cross-platform**: Works on Windows and Linux

## 🛠️ What the Setup Does

The automated setup script will:

1. **Install Dependencies**: All required Node.js packages
2. **Download yt-dlp**: Latest version for video downloading
3. **Configure FFmpeg**: Video processing and merging
4. **Create .env**: Automatic path configuration
5. **Setup Directories**: Create required folders

## 📋 Requirements

- **Node.js** (v16 or higher)
- **Chrome/Chromium** browser
- **Internet connection** for downloads

## 🎯 Usage

1. **Start the server**:
   ```bash
   npm start
   ```

2. **Open your browser**: Navigate to `http://localhost:3000`

3. **Upload or Download**: 
   - Upload local videos OR
   - Paste YouTube URLs to download

4. **Automated Processing**: The system will automatically:
   - Process videos through CapCut
   - Apply background removal
   - Export final results

## 📁 Project Structure

```
capcut-online-automation/
├── bin/                    # Downloaded binaries (yt-dlp, ffmpeg)
├── uploads/               # Uploaded/downloaded videos
├── downloads/             # Processed videos
├── debug/                 # Debug screenshots
├── public/                # Web interface files
├── server.js              # Main server
├── youtube-downloader.js  # YouTube download logic
├── timeline_test.js       # CapCut automation
├── setup.js              # Automated setup script
├── youtube-cookies.txt    # YouTube authentication cookies
└── .env                  # Configuration (auto-generated)
```

## 🔧 Configuration

Create a `.env` file in the root directory (automatically created by setup script):

```env
# yt-dlp executable path
YTDLP_PATH=./bin/yt-dlp.exe

# FFmpeg executable path
FFMPEG_PATH=./bin/ffmpeg/ffmpeg.exe

# Download settings
DOWNLOAD_QUALITY=bestvideo[height<=1080]+bestaudio
DOWNLOAD_FORMAT=bestvideo[height<=1080]+bestaudio/best[height<=1080]
```

### 🍪 YouTube Authentication (Required)

YouTube requires authentication to download videos. Export your browser cookies:

#### Method 1: Browser Extension (Recommended)
1. Install **"Get cookies.txt LOCALLY"** extension for your browser
2. Go to YouTube and make sure you're logged in
3. Click the extension icon and export cookies
4. Save the file as `youtube-cookies.txt` in the project root directory

#### Method 2: Manual Export
1. Open YouTube in your browser (logged in)
2. Open Developer Tools (F12)
3. Go to Application/Storage → Cookies → https://youtube.com
4. Export all cookies to a Netscape format file
5. Save as `youtube-cookies.txt` in the project root

## 🔧 Manual Configuration

If you need to customize paths, edit the `.env` file:

### Windows Paths:
```bash
YTDLP_PATH=C:\tools\yt-dlp.exe
FFMPEG_PATH=C:\tools\ffmpeg\bin\ffmpeg.exe
```

### Linux Paths:
```bash
YTDLP_PATH=/usr/local/bin/yt-dlp
FFMPEG_PATH=/usr/bin/ffmpeg
```

## 🚨 Troubleshooting

### Common Issues:

1. **"Sign in to confirm you're not a bot"** or **YouTube download fails**: 
   ```powershell
   # Missing YouTube cookies - export from browser and save as youtube-cookies.txt
   # Install "Get cookies.txt LOCALLY" browser extension
   # Export YouTube cookies and save in project root
   ```
2. **"yt-dlp not found"**: Run `node setup.js` again
3. **"FFmpeg not found"** or **FFmpeg extraction failed**: 
   ```powershell
   # Fix FFmpeg path to use npm package
   powershell -Command "(Get-Content .env) -replace 'FFMPEG_PATH=.*bin\\ffmpeg\\ffmpeg.exe', 'FFMPEG_PATH=' + (Get-ChildItem node_modules\@ffmpeg-installer\win32-x64\ffmpeg.exe).FullName | Set-Content .env"
   ```
3. **PowerShell execution policy**: If `.\setup.bat` fails, run:
   ```powershell
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   .\setup.bat
   ```
4. **"End of Central Directory record could not be found"**: FFmpeg zip corrupted, use npm package fallback (command above)
5. **Browser not found**: Install Chrome or set `CHROME_PATH` in environment
6. **Permission errors**: Run as administrator (Windows) or use `sudo` (Linux)

### Manual FFmpeg Installation:
If automatic FFmpeg download fails:
```powershell
# Download FFmpeg manually
# 1. Go to: https://github.com/BtbN/FFmpeg-Builds/releases
# 2. Download: ffmpeg-master-latest-win64-gpl.zip
# 3. Extract ffmpeg.exe to: bin\ffmpeg\ffmpeg.exe
# Or use the npm package (recommended):
powershell -Command "(Get-Content .env) -replace 'FFMPEG_PATH=.*', 'FFMPEG_PATH=' + (Get-ChildItem node_modules\@ffmpeg-installer\win32-x64\ffmpeg.exe).FullName | Set-Content .env"
```

### Verify Installation:
```powershell
# Check if yt-dlp works
.\bin\yt-dlp.exe --version

# Check if FFmpeg works (using npm package)
node -e "console.log(require('@ffmpeg-installer/ffmpeg').path)"

# Check .env file
type .env
```

### Debug Mode:
```bash
DEBUG=* npm start
```

## 🌐 Deployment

### VPS/Server Deployment:
1. Clone repository on server
2. Run setup script
3. Configure firewall for port 3000
4. Use PM2 for process management:
   ```bash
   npm install -g pm2
   pm2 start server.js --name capcut-automation
   ```

## 📝 API Endpoints

- `GET /` - Web interface
- `POST /youtube/download` - Download YouTube video
- `POST /upload` - Upload local video
- `GET /videos` - List processed videos
- `GET /progress` - Real-time progress updates

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Make changes
4. Test thoroughly
5. Submit pull request

## 📄 License

MIT License - see LICENSE file for details

## 🆘 Support

For issues and support:
- Check the troubleshooting section
- Review debug screenshots in `/debug` folder
- Open an issue on GitHub

---

**Note**: This tool is for educational purposes. Respect YouTube's terms of service and copyright laws.
