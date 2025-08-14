# CapCut Online Automation

Automated YouTube video processing pipeline that downloads videos and processes them through CapCut's online editor with background removal and effects.

## 🚀 Quick Setup

### Windows (Recommended)
```bash
git clone https://github.com/mustapharajaa/capcut-online-automation.git
cd capcut-online-automation
setup.bat
```

### Linux/VPS
```bash
git clone https://github.com/mustapharajaa/capcut-online-automation.git
cd capcut-online-automation
chmod +x setup.sh
./setup.sh
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
└── .env                  # Configuration (auto-generated)
```

## ⚙️ Configuration

The `.env` file is automatically created with optimal settings:

```bash
# yt-dlp executable path
YTDLP_PATH=./bin/yt-dlp.exe

# FFmpeg executable path  
FFMPEG_PATH=./bin/ffmpeg.exe

# Download quality settings
DOWNLOAD_FORMAT=bestvideo[height<=1080]+bestaudio/best[height<=1080]
```

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

1. **"yt-dlp not found"**: Run `node setup.js` again
2. **"FFmpeg not found"**: Install FFmpeg manually or check paths
3. **Browser not found**: Install Chrome or set `CHROME_PATH` in environment
4. **Permission errors**: Run as administrator (Windows) or use `sudo` (Linux)

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
