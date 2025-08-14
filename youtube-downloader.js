const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const YtDlpWrap = require('yt-dlp-wrap');
const ffmpeg = require('@ffmpeg-installer/ffmpeg');

const FFMPEG_PATH = ffmpeg.path; 

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/**
 * Sanitize a string to be safe for use as a filename
 * @param {string} title - The title to sanitize
 * @returns {string} - Sanitized filename
 */
function sanitizeFilename(title) {
    // Remove or replace invalid characters for Windows/Unix filenames
    return title
        .replace(/[\u003c\u003e:"/\\|?*]/g, '') // Remove invalid characters
        .replace(/[\x00-\x1f\x80-\x9f]/g, '') // Remove control characters
        // Remove emojis and other Unicode symbols that cause Windows issues
        // Keep emojis - only remove variation selectors that cause issues
        .replace(/[\u{FE00}-\u{FE0F}]/gu, '')   // Variation Selectors (invisible modifiers)
        // Remove invisible/zero-width characters that cause Windows issues
        .replace(/[\u200B-\u200D\uFEFF]/g, '') // Zero-width spaces, joiners, BOM
        .replace(/[\u2060-\u2064]/g, '') // Word joiner, invisible operators
        .replace(/[\u00AD]/g, '') // Soft hyphen
        .replace(/^\.|\.$/, '') // Remove leading/trailing dots
        .replace(/\s+/g, ' ') // Replace multiple spaces with single space
        .trim() // Remove leading/trailing whitespace
        .substring(0, 100); // Limit length to 100 characters
}

/**
 * Download a video from YouTube using yt-dlp with real-time FFmpeg merging
 * @param {string} url - YouTube video URL
 * @param {function} progressCallback - Callback function for progress updates
 * @returns {Promise<string>} - Path to the downloaded video file
 */
async function downloadYouTubeVideo(url, progressCallback = null) {
    return new Promise((resolve, reject) => {
        // Validate URL
        if (!url || (!url.includes('youtube.com') && !url.includes('youtu.be'))) {
            reject(new Error('Invalid YouTube URL'));
            return;
        }

        // Generate timestamp-based filename
        const timestamp = Date.now();
        const finalOutputPath = path.join(UPLOADS_DIR, `${timestamp}.mp4`);
        const infoJsonPath = path.join(UPLOADS_DIR, `${timestamp}.info.json`);

        // Check if FFmpeg is available for post-processing merge
        const useFFmpegMerge = fs.existsSync(FFMPEG_PATH);
        
        if (useFFmpegMerge) {
            // Use yt-dlp with FFmpeg post-processing for merging
            downloadWithFFmpegMerge(url, finalOutputPath, infoJsonPath, progressCallback, resolve, reject);
        } else {
            // Fallback to standard yt-dlp download
            downloadWithStandardMethod(url, timestamp, progressCallback, resolve, reject);
        }
    });
}

/**
 * Download with real-time FFmpeg merging using process pipes
 */
function downloadWithFFmpegMerge(url, finalOutputPath, infoJsonPath, progressCallback, resolve, reject) {
    if (progressCallback) {
        progressCallback('🚀 Starting real-time FFmpeg merging...');
    }

    // Use yt-dlp with FFmpeg for real-time merging
    // yt-dlp will automatically use FFmpeg to merge streams when outputting to stdout
    const ytdlpArgs = [
        '--format', process.env.DOWNLOAD_FORMAT || 'bestvideo[height<=1080]+bestaudio/best[height<=1080]',
        '--output', '-',        // Output to stdout (pipe to FFmpeg)
        '--no-playlist',
        '--ffmpeg-location', FFMPEG_PATH, // Tell yt-dlp where FFmpeg is
        url
    ];

    // Also create info.json file separately
    const infoArgs = [
        '--write-info-json',
        '--skip-download',      // Only get info, don't download
        '--output', infoJsonPath.replace('.info.json', ''),
        url
    ];

    console.log(`Getting video info: yt-dlp ${infoArgs.join(' ')}`);
    console.log(`Starting real-time merge: yt-dlp ${ytdlpArgs.join(' ')}`);

    // First get video info (non-blocking)
            const infoProcess = YtDlpWrap.spawn(infoArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true
    });

    infoProcess.on('close', () => {
        console.log('📝 Video info saved');
    });

    // Start yt-dlp process that will use FFmpeg internally for real-time merging
            const ytdlp = YtDlpWrap.spawn(ytdlpArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true
    });

    // Create FFmpeg process to receive piped data from yt-dlp
    const ffmpegArgs = [
        '-i', 'pipe:0',        // Input from stdin (yt-dlp output)
        '-c', 'copy',           // Copy streams without re-encoding
        '-movflags', 'faststart', // Optimize for web playback
        '-avoid_negative_ts', 'make_zero', // Fix timestamp issues
        '-fflags', '+genpts',   // Generate presentation timestamps
        '-max_muxing_queue_size', '1024', // Increase muxing queue for long videos
        '-y',                   // Overwrite output file
        finalOutputPath
    ];

    console.log(`FFmpeg receiving pipe: ${FFMPEG_PATH} ${ffmpegArgs.join(' ')}`);

    const ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
        timeout: 0  // No timeout for long videos
    });

    // Pipe yt-dlp output directly to FFmpeg input
    ytdlp.stdout.pipe(ffmpeg.stdin);
    
    // Add debugging for pipe events
    ytdlp.stdout.on('end', () => {
        console.log('🔍 DEBUG: yt-dlp stdout ended');
        
        // For long videos, add a small delay before closing FFmpeg stdin
        // to ensure all data has been processed
        setTimeout(() => {
            console.log('🔍 DEBUG: Closing FFmpeg stdin...');
            try {
                ffmpeg.stdin.end(); // Explicitly close FFmpeg stdin
            } catch (e) {
                console.log('🔍 DEBUG: FFmpeg stdin already closed:', e.message);
            }
        }, 500); // 500ms delay for long videos
    });
    
    ytdlp.stdout.on('close', () => {
        console.log('🔍 DEBUG: yt-dlp stdout closed');
    });
    
    ffmpeg.stdin.on('error', (err) => {
        console.log('🔍 DEBUG: FFmpeg stdin error:', err.message);
    });
    
    ffmpeg.stdout.on('data', (data) => {
        console.log('🔍 DEBUG: FFmpeg stdout:', data.toString().trim());
    });
    
    ffmpeg.stderr.on('data', (data) => {
        const output = data.toString();
        if (output.includes('frame=') || output.includes('time=')) {
            // Only log progress every few seconds to avoid spam
            if (Math.random() < 0.1) { // 10% chance to log
                console.log('🔍 FFmpeg progress:', output.trim());
            }
        } else {
            console.log('🔍 FFmpeg stderr:', output.trim());
        }
    });

    let errorOutput = '';

    ytdlp.stdout.on('data', (data) => {
        // Don't log binary video data - only log text output
        const output = data.toString();
        
        // Check if this is binary data (contains non-printable characters)
        const isBinaryData = /[\x00-\x08\x0E-\x1F\x7F-\xFF]/.test(output);
        
        if (!isBinaryData && output.trim()) {
            console.log('yt-dlp stdout:', output.trim());
        }

        // Parse video format and resolution info
        if (output.includes('[info]') && output.includes('Downloading 1 format(s):')) {
            const formatMatch = output.match(/\[info\].*Downloading 1 format\(s\): ([\d+]+)/);
            if (formatMatch) {
                const formatCode = formatMatch[1].split('+')[0]; // Get first format code
                console.log(`🎥 VIDEO FORMAT: ${formatCode}`);

                const formatInfo = {
                    '18': '360p MP4 (AVC)',
                    '22': '720p MP4 (AVC)', 
                    '37': '1080p MP4 (AVC)',
                    '136': '720p MP4 (AVC video only)',
                    '137': '1080p MP4 (AVC video only)',
                    '298': '720p MP4 (AVC)',
                    '299': '1080p MP4 (AVC)',
                    '398': '720p MP4 (AV01 video only)',
                    '399': '1080p MP4 (AV01 video only)',
                    '251': 'Audio Only (Opus)'
                };

                const resolution = formatInfo[formatCode] || `Format ${formatCode}`;
                console.log(`📺 RESOLUTION: ${resolution}`);

                if (progressCallback) {
                    progressCallback(`🎥 Downloading: ${resolution}`);
                }
            }
        }

        // Parse download progress
        if (output.includes('[download]') && output.includes('%')) {
            const progressMatch = output.match(/\[(download)\]\s+([\d.]+)%/);
            if (progressMatch && progressCallback) {
                const percent = parseFloat(progressMatch[2]);
                progressCallback(`📹 Downloading: ${percent.toFixed(1)}%`);
            }
        }

        // Extract destination filenames
        if (output.includes('[download] Destination:')) {
            const destMatch = output.match(/\[download\] Destination: (.+)/);
            if (destMatch) {
                downloadedFiles.push(destMatch[1].trim());
            }
        }
    });

    ytdlp.stderr.on('data', (data) => {
        const error = data.toString();
        
        // Only log text errors, not binary data
        const isBinaryData = /[\x00-\x08\x0E-\x1F\x7F-\xFF]/.test(error);
        
        if (!isBinaryData && error.trim()) {
            console.log('yt-dlp stderr:', error.trim());
        }
        
        errorOutput += error;
    });

    // Don't handle completion on yt-dlp close - wait for FFmpeg to finish
    ytdlp.on('close', (code) => {
        console.log(`🔍 DEBUG: yt-dlp process closed with code: ${code}`);
        
        if (code !== 0) {
            console.log(`❌ yt-dlp failed with code ${code}`);
            reject(new Error(`yt-dlp failed with code ${code}: ${errorOutput}`));
        } else {
            console.log('✅ yt-dlp completed successfully, waiting for FFmpeg to finish...');
        }
        // Don't resolve here - wait for FFmpeg to complete
    });
    
    // Add exit event for yt-dlp
    ytdlp.on('exit', (code, signal) => {
        console.log(`🔍 DEBUG: yt-dlp process exited with code: ${code}, signal: ${signal}`);
    });

    // Track if process has completed to prevent hanging
    let processCompleted = false;
    
    // Handle completion when FFmpeg finishes (this is when the file is actually ready)
    ffmpeg.on('close', (code) => {
        if (processCompleted) return; // Prevent duplicate handling
        processCompleted = true;
        
        console.log(`🔍 FFmpeg process closed with code: ${code}`);
        
        if (code === 0) {
            // FFmpeg completed successfully - file is now ready for renaming
            console.log('✅ FFmpeg completed - file ready for renaming');
            
            // Verify the output file exists and has content
            if (fs.existsSync(finalOutputPath)) {
                const stats = fs.statSync(finalOutputPath);
                console.log(`📊 Output file size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
                
                if (stats.size > 0) {
                    // Wait a moment to ensure file handles are released
                    setTimeout(() => {
                        // Handle file renaming with video title
                        handleFileRenaming(finalOutputPath, infoJsonPath, progressCallback, resolve, reject);
                    }, 1000); // Increased delay for long videos
                } else {
                    reject(new Error('FFmpeg output file is empty'));
                }
            } else {
                reject(new Error('FFmpeg output file was not created'));
            }
        } else {
            reject(new Error(`FFmpeg failed with code ${code}`));
        }
    });
    
    // Add timeout for very long videos (30 minutes max)
    const processTimeout = setTimeout(() => {
        if (!processCompleted) {
            console.log('⚠️ FFmpeg process timeout - killing process');
            processCompleted = true;
            
            // Kill both processes
            try {
                ytdlp.kill('SIGTERM');
                ffmpeg.kill('SIGTERM');
            } catch (e) {
                console.log('Error killing processes:', e.message);
            }
            
            reject(new Error('FFmpeg process timed out after 30 minutes'));
        }
    }, 30 * 60 * 1000); // 30 minutes timeout
    
    // Clear timeout when process completes
    ffmpeg.on('close', () => {
        clearTimeout(processTimeout);
    });

    ffmpeg.on('error', (error) => {
        reject(new Error(`FFmpeg process error: ${error.message}`));
    });

    ytdlp.on('error', (error) => {
        reject(new Error(`Failed to start yt-dlp: ${error.message}`));
    });
}

/**
 * Merge video and audio files using FFmpeg
 */
function mergeWithFFmpeg(videoPath, audioPath, outputPath, infoJsonPath, progressCallback, resolve, reject) {
    if (progressCallback) {
        progressCallback('🔄 Merging video and audio with FFmpeg...');
    }

    console.log(`🔄 Merging: ${path.basename(videoPath)} + ${path.basename(audioPath)}`);

    const ffmpegArgs = [
        '-i', videoPath,        // Video input
        '-i', audioPath,        // Audio input
        '-c', 'copy',           // Copy streams without re-encoding
        '-movflags', 'faststart', // Optimize for web playback
        '-y',                   // Overwrite output file
        outputPath
    ];

    console.log(`Executing FFmpeg: ${FFMPEG_PATH} ${ffmpegArgs.join(' ')}`);

    const ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true
    });

    let ffmpegError = '';

    ffmpeg.stdout.on('data', (data) => {
        const output = data.toString();
        const isBinaryData = /[\x00-\x08\x0E-\x1F\x7F-\xFF]/.test(output);
        
        if (!isBinaryData && output.trim()) {
            console.log('FFmpeg stdout:', output.trim());
        }
    });

    ffmpeg.stderr.on('data', (data) => {
        const output = data.toString();
        
        // Only log text output, not binary data
        const isBinaryData = /[\x00-\x08\x0E-\x1F\x7F-\xFF]/.test(output);
        
        if (!isBinaryData && output.trim()) {
            console.log('FFmpeg stderr:', output.trim());
        }
        
        // Parse FFmpeg progress
        if (output.includes('time=')) {
            const timeMatch = output.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
            if (timeMatch && progressCallback) {
                progressCallback(`⚡ Merging progress: ${timeMatch[1]}`);
            }
        }
        
        if (output.includes('error') || output.includes('Error')) {
            ffmpegError += output;
        }
    });

    ffmpeg.on('close', (code) => {
        // Clean up temporary files
        try {
            if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
            if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
        } catch (cleanupError) {
            console.warn('Failed to clean up temporary files:', cleanupError.message);
        }

        if (code === 0) {
            console.log('✅ FFmpeg merge completed successfully');
            
            // Handle file renaming with video title
            handleFileRenaming(outputPath, infoJsonPath, progressCallback, resolve, reject);
        } else {
            reject(new Error(`FFmpeg merge failed with code ${code}: ${ffmpegError}`));
        }
    });

    ffmpeg.on('error', (error) => {
        reject(new Error(`Failed to start FFmpeg: ${error.message}`));
    });
}

/**
 * Fallback to standard yt-dlp download method (no FFmpeg)
 */
function downloadWithStandardMethod(url, timestamp, progressCallback, resolve, reject) {
    const outputTemplate = path.join(UPLOADS_DIR, `${timestamp}.%(ext)s`);

    // yt-dlp arguments
    const args = [
        '--format', process.env.DOWNLOAD_FORMAT || 'best[height<=1080]/best',
        '--output', outputTemplate,
        '--no-playlist',
        '--write-info-json',
        url
    ];

    if (progressCallback) {
        progressCallback('🔍 Starting standard YouTube download (FFmpeg not found)...');
    }

    console.log(`Executing: yt-dlp ${args.join(' ')}`);

    // Spawn yt-dlp process
            const ytDlpProcess = YtDlpWrap.spawn(args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true
    });

    let downloadedFilePath = null;
    let errorOutput = '';

    // Handle stdout (progress and info)
    ytdlp.stdout.on('data', (data) => {
        const output = data.toString();
        console.log('yt-dlp stdout:', output.trim());

        // Parse video format and resolution info
        if (output.includes('[info]') && output.includes('Downloading 1 format(s):')) {
            const formatMatch = output.match(/\[info\].*Downloading 1 format\(s\): (\d+)/);
            if (formatMatch) {
                const formatCode = formatMatch[1];
                console.log(`🎥 VIDEO FORMAT: ${formatCode}`);

                // Common YouTube format codes and their resolutions
                const formatInfo = {
                    '18': '360p MP4 (AVC)',
                    '22': '720p MP4 (AVC)', 
                    '37': '1080p MP4 (AVC)',
                    '136': '720p MP4 (AVC video only)',
                    '137': '1080p MP4 (AVC video only)',
                    '298': '720p MP4 (AVC)',
                    '299': '1080p MP4 (AVC)',
                    '398': '720p MP4 (AV01 video only)',
                    '399': '1080p MP4 (AV01 video only)',
                    '251': 'Audio Only (Opus)'
                };

                const resolution = formatInfo[formatCode] || `Format ${formatCode}`;
                console.log(`📺 RESOLUTION: ${resolution}`);

                if (progressCallback) {
                    progressCallback(`🎥 Video format: ${resolution}`);
                }
            }
        }

        // Parse download progress
        if (output.includes('[download]') && output.includes('%')) {
            const progressMatch = output.match(/\[(download)\]\s+([\d.]+)%/);
            if (progressMatch && progressCallback) {
                const percent = parseFloat(progressMatch[2]);
                progressCallback(`📹 Downloading: ${percent.toFixed(1)}%`);
            }
        }

        // Extract destination filename
        if (output.includes('[download] Destination:')) {
            const destMatch = output.match(/\[download\] Destination: (.+)/);
            if (destMatch) {
                downloadedFilePath = destMatch[1].trim();
            }
        }

        // Check for completion
        if (output.includes('has already been downloaded')) {
            const fileMatch = output.match(/(.+) has already been downloaded/);
            if (fileMatch) {
                downloadedFilePath = fileMatch[1].trim();
            }
        }
    });

    // Handle stderr (errors and warnings)
    ytdlp.stderr.on('data', (data) => {
        const error = data.toString();
        console.error('yt-dlp stderr:', error);
        errorOutput += error;
    });

    // Handle process completion
    ytdlp.on('close', async (code) => {
        if (code === 0) {
            try {
                let finalFilePath = downloadedFilePath;
                
                // If we don't have the exact path, try to find the downloaded file by timestamp
                if (!finalFilePath || !fs.existsSync(finalFilePath)) {
                    const files = fs.readdirSync(UPLOADS_DIR);
                    const downloadedFile = files.find(file => 
                        file.startsWith(timestamp.toString()) && 
                        (file.endsWith('.mp4') || file.endsWith('.webm') || file.endsWith('.mkv'))
                    );
                    
                    if (downloadedFile) {
                        finalFilePath = path.join(UPLOADS_DIR, downloadedFile);
                    } else {
                        reject(new Error('Download completed but file not found'));
                        return;
                    }
                }
                
                // Try to rename the file using the video title from .info.json
                try {
                    const infoJsonPath = finalFilePath.replace(/\.[^.]+$/, '.info.json');
                    
                    if (fs.existsSync(infoJsonPath)) {
                        if (progressCallback) {
                            progressCallback('📝 Reading video metadata...');
                        }
                        
                        const infoData = JSON.parse(fs.readFileSync(infoJsonPath, 'utf8'));
                        const videoTitle = infoData.title;
                        
                        if (videoTitle) {
                            const sanitizedTitle = sanitizeFilename(videoTitle);
                            const fileExtension = path.extname(finalFilePath);
                            const newFileName = `${sanitizedTitle}${fileExtension}`;
                            const newFilePath = path.join(UPLOADS_DIR, newFileName);
                            
                            // Rename the video file
                            fs.renameSync(finalFilePath, newFilePath);
                            
                            // Also rename the .info.json file to match
                            const newInfoJsonPath = path.join(UPLOADS_DIR, `${sanitizedTitle}.info.json`);
                            fs.renameSync(infoJsonPath, newInfoJsonPath);
                            
                            console.log(`✅ File renamed to: ${newFileName}`);
                            
                            if (progressCallback) {
                                progressCallback(`✅ Download completed: ${newFileName}`);
                            }
                            
                            resolve(newFilePath);
                            return;
                        }
                    }
                } catch (renameError) {
                    console.warn('Failed to rename file using video title:', renameError.message);
                    console.log('Continuing with timestamp-based filename...');
                }
                
                // Fallback: use the original filename if renaming failed
                if (progressCallback) {
                    progressCallback(`✅ Download completed: ${path.basename(finalFilePath)}`);
                }
                resolve(finalFilePath);
                
            } catch (error) {
                reject(new Error(`Error processing downloaded file: ${error.message}`));
            }
        } else {
            reject(new Error(`yt-dlp failed with code ${code}: ${errorOutput}`));
        }
    });

    // Handle process errors
    ytdlp.on('error', (error) => {
        reject(new Error(`Failed to start yt-dlp: ${error.message}`));
    });
}

/**
 * Update videos.json with new video entry
 */
function updateVideosJson(videoName, description, status = 'filed') {
    const videosJsonPath = path.join(__dirname, 'videos.json');
    let videosData = { videos: [] };
    
    // Read existing videos.json if it exists
    if (fs.existsSync(videosJsonPath)) {
        try {
            const fileContent = fs.readFileSync(videosJsonPath, 'utf8');
            videosData = JSON.parse(fileContent);
        } catch (error) {
            console.warn('Failed to read videos.json, creating new one:', error.message);
            videosData = { videos: [] };
        }
    }
    
    // Check if video already exists (avoid duplicates)
    const existingVideo = videosData.videos.find(v => v.name === videoName);
    if (!existingVideo) {
        // Add new video entry
        videosData.videos.push({
            name: videoName,
            description: description || '',
            status: status
        });
        
        // Write back to file
        try {
            fs.writeFileSync(videosJsonPath, JSON.stringify(videosData, null, 2));
            console.log(`✅ Added video to videos.json: ${videoName}`);
        } catch (error) {
            console.warn('Failed to update videos.json:', error.message);
        }
    } else {
        console.log(`📝 Video already exists in videos.json: ${videoName}`);
    }
}

/**
 * Handle file renaming with video title (shared by both methods)
 */
function handleFileRenaming(finalFilePath, infoJsonPath, progressCallback, resolve, reject) {
    try {
        // Try to rename file using video title from info.json
        if (fs.existsSync(infoJsonPath)) {
            try {
                const infoData = JSON.parse(fs.readFileSync(infoJsonPath, 'utf8'));
                const videoTitle = infoData.title;
                
                if (videoTitle) {
                    const sanitizedTitle = sanitizeFilename(videoTitle);
                    const fileExtension = path.extname(finalFilePath);
                    const newFileName = `${sanitizedTitle}${fileExtension}`;
                    const newFilePath = path.join(UPLOADS_DIR, newFileName);
                    
                    // Rename the video file
                    fs.renameSync(finalFilePath, newFilePath);
                    
                    // Also rename the .info.json file to match
                    const newInfoJsonPath = path.join(UPLOADS_DIR, `${sanitizedTitle}.info.json`);
                    fs.renameSync(infoJsonPath, newInfoJsonPath);
                    
                    // Update videos.json with new video entry
                    const description = infoData.description || '';
                    updateVideosJson(sanitizedTitle, description, 'downloaded');
                    
                    console.log(`✅ File renamed to: ${newFileName}`);
                    
                    if (progressCallback) {
                        progressCallback(`✅ Download completed: ${newFileName}`);
                    }
                    
                    resolve(newFilePath);
                    return;
                }
            } catch (renameError) {
                console.warn('Failed to rename file using video title:', renameError.message);
                console.log('Continuing with timestamp-based filename...');
            }
        }
        
        // Fallback: use the original filename if renaming failed
        if (progressCallback) {
            progressCallback(`✅ Download completed: ${path.basename(finalFilePath)}`);
        }
        resolve(finalFilePath);
        
    } catch (error) {
        reject(new Error(`Error processing downloaded file: ${error.message}`));
    }
}

/**
 * Get video information without downloading
 * @param {string} url - YouTube video URL
 * @returns {Promise<object>} - Video information
 */
async function getVideoInfo(url) {
    return new Promise((resolve, reject) => {
        const args = [
            url,
            '--dump-json',
            '--no-playlist'
        ];

                        const ytdlp = YtDlpWrap.spawn(args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true
        });

        let jsonOutput = '';
        let errorOutput = '';

        ytdlp.stdout.on('data', (data) => {
            jsonOutput += data.toString();
        });

        ytdlp.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        ytdlp.on('close', (code) => {
            if (code === 0) {
                try {
                    const videoInfo = JSON.parse(jsonOutput);
                    resolve({
                        title: videoInfo.title,
                        duration: videoInfo.duration,
                        uploader: videoInfo.uploader,
                        view_count: videoInfo.view_count,
                        upload_date: videoInfo.upload_date
                    });
                } catch (parseError) {
                    reject(new Error(`Failed to parse video info: ${parseError.message}`));
                }
            } else {
                reject(new Error(`Failed to get video info: ${errorOutput}`));
            }
        });

        ytdlp.on('error', (error) => {
            reject(new Error(`Failed to start yt-dlp: ${error.message}`));
        });
    });
}

module.exports = {
    downloadYouTubeVideo,
    getVideoInfo
};
