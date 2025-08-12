# CapCut Web Automation Tool

An automated tool for processing videos through CapCut's web interface, featuring background removal, YouTube video downloading, and batch processing capabilities.

## Features

- **Automated Background Removal**: Uses CapCut's web interface to automatically remove backgrounds from videos
- **YouTube Integration**: Download videos directly from YouTube URLs
- **Batch Processing**: Process multiple videos in queue
- **Real-time Progress Tracking**: Web interface with live progress updates
- **Error Handling**: Robust error handling with detailed feedback
- **Browser Automation**: Uses Puppeteer for reliable web automation

## Prerequisites

- Node.js (v14 or higher)
- Chrome/Chromium browser
- yt-dlp executable
- FFmpeg executable

## Installation

1. Clone this repository:
```bash
git clone <your-repo-url>
cd capcut-auto
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
   - Copy `.env.example` to `.env`
   - Update the paths to your yt-dlp and FFmpeg executables

4. Configure CapCut editors:
   - Copy `editors.json.example` to `editors.json`
   - Replace the example URLs with your actual CapCut project URLs
   - Update workspace and space IDs with your own

## Configuration

### Environment Variables (.env)
```
YTDLP_PATH=path/to/your/yt-dlp.exe
FFMPEG_PATH=path/to/your/ffmpeg.exe
DOWNLOAD_QUALITY=bestvideo[height<=1080]+bestaudio
DOWNLOAD_FORMAT=bestvideo[height<=1080]+bestaudio/best[height<=1080]
```

### Editor Configuration (editors.json)
```json
[
    {
        "url": "https://www.capcut.com/editor/YOUR-PROJECT-ID",
        "status": "available",
        "tabId": 1
    }
]
```

## Usage

1. Start the server:
```bash
npm start
```

2. Open your browser and navigate to `http://localhost:3000`

3. Upload videos or paste YouTube URLs to process

## Project Structure

- `server.js` - Main Express server
- `timeline_test.js` - Core automation pipeline
- `youtube-downloader.js` - YouTube download functionality
- `videos.js` - Video status management
- `public/` - Web interface files
- `uploads/` - Uploaded video files (created automatically)
- `downloads/` - Downloaded video files (created automatically)
- `debug/` - Debug screenshots (created automatically)

## Error Handling

The application includes comprehensive error handling for:
- Navigation failures (expired CapCut URLs)
- Upload timeouts
- Processing errors
- Download failures

Critical errors like "Navigating frame was detached" are displayed in a dedicated error box with helpful troubleshooting information.

## Troubleshooting

### Common Issues

1. **"Navigating frame was detached" error**
   - This usually indicates expired CapCut project URLs
   - Update your `editors.json` with fresh project URLs from CapCut

2. **Upload failures**
   - Check that your video files are in supported formats
   - Ensure CapCut editor URLs are valid and accessible

3. **Download issues**
   - Verify yt-dlp and FFmpeg paths in `.env`
   - Check that the YouTube URL is valid and accessible

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is for educational purposes. Please respect CapCut's terms of service when using this tool.

## Disclaimer

This tool automates interactions with CapCut's web interface. Use responsibly and in accordance with CapCut's terms of service. The authors are not responsible for any misuse or violations of third-party services.
