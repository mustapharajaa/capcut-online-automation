const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const os = require('os');

console.log('🚀 CapCut Automation Setup');
console.log('========================');

const isWindows = os.platform() === 'win32';
const binDir = path.join(__dirname, 'bin');
const envPath = path.join(__dirname, '.env');

// Create bin directory
if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
    console.log('📁 Created bin directory');
}

async function downloadFile(url, outputPath) {
    return new Promise((resolve, reject) => {
        console.log(`📥 Downloading ${path.basename(outputPath)}...`);
        const file = fs.createWriteStream(outputPath);
        
        https.get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                // Handle redirects
                return downloadFile(response.headers.location, outputPath).then(resolve).catch(reject);
            }
            
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                console.log(`✅ Downloaded ${path.basename(outputPath)}`);
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(outputPath, () => {}); // Delete partial file
            reject(err);
        });
    });
}

async function setupWindows() {
    console.log('🪟 Setting up for Windows...');
    
    const ytdlpPath = path.join(binDir, 'yt-dlp.exe');
    const ffmpegDir = path.join(binDir, 'ffmpeg');
    const ffmpegPath = path.join(ffmpegDir, 'ffmpeg.exe');
    
    try {
        // Download yt-dlp
        if (!fs.existsSync(ytdlpPath)) {
            await downloadFile('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe', ytdlpPath);
        } else {
            console.log('✅ yt-dlp already exists');
        }
        
        // Download FFmpeg (simplified - user can manually download if needed)
        console.log('📋 FFmpeg setup:');
        console.log('   Please download FFmpeg from: https://ffmpeg.org/download.html#build-windows');
        console.log(`   Extract to: ${ffmpegDir}`);
        console.log('   Or use the @ffmpeg-installer/ffmpeg package (already in dependencies)');
        
        // Create .env file
        const envContent = `# CapCut Automation Environment Configuration
# Generated automatically by setup.js

# yt-dlp executable path
YTDLP_PATH=${ytdlpPath.replace(/\\/g, '\\\\')}

# FFmpeg executable path (update if you downloaded manually)
FFMPEG_PATH=${ffmpegPath.replace(/\\/g, '\\\\')}

# Download settings
DOWNLOAD_QUALITY=bestvideo[height<=1080]+bestaudio
DOWNLOAD_FORMAT=bestvideo[height<=1080]+bestaudio/best[height<=1080]
`;
        
        fs.writeFileSync(envPath, envContent);
        console.log('✅ Created .env file');
        
    } catch (error) {
        console.error('❌ Setup failed:', error.message);
        process.exit(1);
    }
}

async function setupLinux() {
    console.log('🐧 Setting up for Linux...');
    
    try {
        // Try to install yt-dlp
        console.log('📥 Installing yt-dlp...');
        try {
            execSync('curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp', { stdio: 'inherit' });
            execSync('chmod a+rx /usr/local/bin/yt-dlp', { stdio: 'inherit' });
            console.log('✅ yt-dlp installed');
        } catch (error) {
            console.log('⚠️  Could not install yt-dlp globally. Downloading to local bin...');
            const ytdlpPath = path.join(binDir, 'yt-dlp');
            await downloadFile('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp', ytdlpPath);
            execSync(`chmod +x ${ytdlpPath}`);
        }
        
        // Try to install FFmpeg
        console.log('📥 Installing FFmpeg...');
        try {
            execSync('sudo apt update && sudo apt install -y ffmpeg', { stdio: 'inherit' });
            console.log('✅ FFmpeg installed');
        } catch (error) {
            console.log('⚠️  Could not install FFmpeg. Please install manually: sudo apt install ffmpeg');
        }
        
        // Create .env file
        const envContent = `# CapCut Automation Environment Configuration
# Generated automatically by setup.js

# yt-dlp executable path
YTDLP_PATH=/usr/local/bin/yt-dlp

# FFmpeg executable path
FFMPEG_PATH=/usr/bin/ffmpeg

# Download settings
DOWNLOAD_QUALITY=bestvideo[height<=1080]+bestaudio
DOWNLOAD_FORMAT=bestvideo[height<=1080]+bestaudio/best[height<=1080]
`;
        
        fs.writeFileSync(envPath, envContent);
        console.log('✅ Created .env file');
        
    } catch (error) {
        console.error('❌ Setup failed:', error.message);
        process.exit(1);
    }
}

async function main() {
    try {
        if (isWindows) {
            await setupWindows();
        } else {
            await setupLinux();
        }
        
        console.log('\n🎉 Setup completed successfully!');
        console.log('📋 Next steps:');
        console.log('   1. Run: npm install');
        console.log('   2. Run: npm start');
        console.log('   3. Open http://localhost:3000');
        console.log('\n💡 If you encounter issues, check the .env file and update paths as needed.');
        
    } catch (error) {
        console.error('❌ Setup failed:', error.message);
        process.exit(1);
    }
}

main();
