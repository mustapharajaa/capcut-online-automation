const express = require('express');
const fs = require('fs');
const path = require('path');

// Get the uploads and downloads directory paths
const uploadsDir = path.join(__dirname, 'uploads');
const downloadsDir = path.join(__dirname, 'downloads');

// Create router for API routes
const router = express.Router();

/**
 * Determine video processing status based on files present
 * @param {string} baseName - Base filename without extension
 * @param {string} directoryPath - Directory path where the video is located
 * @param {string} folderName - Name of the folder ('uploads' or 'downloads')
 * @returns {string} Status: 'downloaded', 'rmbg', or 'complete'
 */
function determineVideoStatus(baseName, directoryPath, folderName) {
    // Check for status marker files first (most reliable)
    const completeMarker = path.join(directoryPath, `${baseName}_complete.marker`);
    const rmbgMarker = path.join(directoryPath, `${baseName}_rmbg.marker`);
    const downloadedMarker = path.join(directoryPath, `${baseName}_downloaded.marker`);
    const filedMarker = path.join(directoryPath, `${baseName}_filed.marker`); // Legacy marker
    
    if (fs.existsSync(completeMarker)) {
        return 'complete'; // Video uploaded to YouTube
    }
    
    if (fs.existsSync(rmbgMarker)) {
        return 'rmbg'; // Video processed through CapCut
    }
    
    // Fallback: Check for processed/exported files from CapCut
    const processedFiles = [
        `${baseName}_processed.mp4`,
        `${baseName}_rmbg.mp4`,
        `${baseName}_exported.mp4`,
        `${baseName}_capcut.mp4`
    ];
    
    // Check if any processed file exists (indicates CapCut processing completed)
    const hasProcessedFile = processedFiles.some(fileName => {
        const filePath = path.join(directoryPath, fileName);
        return fs.existsSync(filePath);
    });
    
    if (hasProcessedFile) {
        return 'rmbg'; // Video has been processed through CapCut
    }
    
    // Default status based on folder location
    if (folderName === 'downloads') {
        return 'complete'; // Videos in downloads are typically processed/complete
    } else {
        return 'downloaded'; // Videos in uploads are newly downloaded
    }
}

/**
 * Update video status by creating a status marker file
 * @param {string} filename - Video filename
 * @param {string} status - New status ('filed', 'rmbg', 'complete')
 * @returns {Promise<boolean>} Success status
 */
function updateVideoStatus(filename, status) {
    try {
        const baseName = path.basename(filename, path.extname(filename));
        const statusFile = path.join(uploadsDir, `${baseName}_${status}.marker`);
        
        // Create status marker file
        fs.writeFileSync(statusFile, JSON.stringify({
            filename: filename,
            status: status,
            timestamp: new Date().toISOString()
        }), 'utf8');
        
        console.log(`✅ Status marker created: ${baseName}_${status}.marker`);
        return true;
    } catch (error) {
        console.error(`❌ Error updating video status:`, error.message);
        return false;
    }
}

/**
 * Automatically update video status in videos.json
 * @param {string} videoName - Video name (without extension)
 * @param {string} newStatus - New status ('downloaded', 'processed', 'complete')
 * @returns {boolean} Success status
 */
function updateVideoStatusInJson(videoName, newStatus) {
    try {
        const videosJsonPath = path.join(__dirname, 'videos.json');
        
        if (!fs.existsSync(videosJsonPath)) {
            console.log('⚠️ videos.json not found, cannot update status');
            return false;
        }
        
        const videosData = JSON.parse(fs.readFileSync(videosJsonPath, 'utf8'));
        
        // Find the video entry by name
        const videoEntry = videosData.videos.find(video => video.name === videoName);
        
        if (videoEntry) {
            const oldStatus = videoEntry.status;
            videoEntry.status = newStatus;
            
            // Write back to file
            fs.writeFileSync(videosJsonPath, JSON.stringify(videosData, null, 2));
            
            console.log(`✅ Updated video status: ${videoName} (${oldStatus} → ${newStatus})`);
            return true;
        } else {
            console.log(`⚠️ Video not found in videos.json: ${videoName}`);
            return false;
        }
        
    } catch (error) {
        console.error('❌ Error updating video status in videos.json:', error.message);
        return false;
    }
}

/**
 * Monitor downloads directory and automatically update status for completed videos
 */
function checkAndUpdateCompletedVideos() {
    try {
        if (!fs.existsSync(downloadsDir)) return;
        
        const videosJsonPath = path.join(__dirname, 'videos.json');
        if (!fs.existsSync(videosJsonPath)) return;
        
        const videosData = JSON.parse(fs.readFileSync(videosJsonPath, 'utf8'));
        const downloadedFiles = fs.readdirSync(downloadsDir)
            .filter(file => file.endsWith('.mp4'))
            .map(file => path.basename(file, '.mp4'));
        
        // Check each video with "downloaded" status
        for (const videoEntry of videosData.videos) {
            if (videoEntry.status === 'downloaded') {
                // Look for matching file in downloads (with emoji normalization)
                const normalizedVideoName = videoEntry.name
                    .replace(/[\u{1F600}-\u{1F64F}]/gu, '_')  // Emoticons
                    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '_')  // Misc Symbols
                    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '_')  // Transport
                    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '_')  // Flags
                    .replace(/[\u{2600}-\u{26FF}]/gu, '_')   // Misc symbols
                    .replace(/[\u{2700}-\u{27BF}]/gu, '_')   // Dingbats
                    .replace(/[^\w\s.-]/g, '_')              // Other special chars
                    .replace(/_+/g, '_')                     // Multiple underscores → single
                    .replace(/^_|_$/g, '')                   // Remove leading/trailing underscores
                    .toLowerCase();
                
                // Check if any downloaded file matches (partial match for truncated names)
                const matchingFile = downloadedFiles.find(downloadName => {
                    const normalizedDownload = downloadName
                        .replace(/[^\w\s.-]/g, '_')
                        .replace(/_+/g, '_')
                        .replace(/^_|_$/g, '')
                        .toLowerCase();
                    
                    return normalizedDownload.includes(normalizedVideoName.substring(0, 30)) || 
                           normalizedVideoName.includes(normalizedDownload.substring(0, 30)) ||
                           normalizedDownload === normalizedVideoName;
                });
                
                if (matchingFile) {
                    console.log(`🏆 Auto-detected completed automation for: ${videoEntry.name}`);
                    
                    // Update status to processed
                    const updateSuccess = updateVideoStatusInJson(videoEntry.name, 'processed');
                    
                    if (updateSuccess) {
                        // Also delete original files from uploads if they exist
                        const originalVideoPath = path.join(uploadsDir, `${videoEntry.name}.mp4`);
                        const originalInfoPath = path.join(uploadsDir, `${videoEntry.name}.info.json`);
                        
                        try {
                            if (fs.existsSync(originalVideoPath)) {
                                fs.unlinkSync(originalVideoPath);
                                console.log(`🗑️ Deleted original video: ${videoEntry.name}.mp4`);
                            }
                            
                            if (fs.existsSync(originalInfoPath)) {
                                fs.unlinkSync(originalInfoPath);
                                console.log(`🗑️ Deleted original info: ${videoEntry.name}.info.json`);
                            }
                        } catch (deleteError) {
                            console.warn('⚠️ Could not delete original files:', deleteError.message);
                        }
                        
                        console.log(`✅ Auto-cleanup completed for: ${videoEntry.name}`);
                    }
                }
            }
        }
        
    } catch (error) {
        console.error('⚠️ Error in checkAndUpdateCompletedVideos:', error.message);
    }
}

// Start automatic monitoring every 30 seconds
setInterval(() => {
    checkAndUpdateCompletedVideos();
}, 30000);

console.log('🔄 Started automatic video status monitoring (checks every 30 seconds)');

/**
 * Get list of all downloaded YouTube videos from both uploads and downloads directories
 * @returns {Array} Array of video objects with metadata
 */
function getDownloadedVideos() {
    try {
        const videos = [];
        const directories = [
            { path: uploadsDir, name: 'uploads' },
            { path: downloadsDir, name: 'downloads' }
        ];

        // Load videos.json for status and metadata
        let videosJsonData = { videos: [] };
        const videosJsonPath = path.join(__dirname, 'videos.json');
        if (fs.existsSync(videosJsonPath)) {
            try {
                const fileContent = fs.readFileSync(videosJsonPath, 'utf8');
                videosJsonData = JSON.parse(fileContent);
            } catch (error) {
                console.warn('Failed to read videos.json:', error.message);
            }
        }

        directories.forEach(directory => {
            if (!fs.existsSync(directory.path)) {
                console.log(`${directory.name} directory does not exist`);
                return;
            }

            const files = fs.readdirSync(directory.path);

            files.forEach(file => {
                const filePath = path.join(directory.path, file);
                const stats = fs.statSync(filePath);

                // Only process video files (mp4, webm, mkv, avi, mov)
                const videoExtensions = ['.mp4', '.webm', '.mkv', '.avi', '.mov'];
                const fileExt = path.extname(file).toLowerCase();

                if (stats.isFile() && videoExtensions.includes(fileExt)) {
                    // Look for corresponding .info.json file
                    const baseName = path.basename(file, fileExt);
                    const infoJsonPath = path.join(directory.path, `${baseName}.info.json`);
                    
                    let videoInfo = {
                        filename: file,
                        filepath: filePath,
                        folder: directory.name, // Track which folder the video is in
                        size: stats.size,
                        downloadDate: stats.mtime,
                        title: baseName, // Default to filename
                        duration: null,
                        uploader: null,
                        url: null,
                        thumbnail: null,
                        description: null,
                        status: directory.name === 'uploads' ? 'downloaded' : 'complete' // Default status based on folder
                    };

                    // Try to read metadata from .info.json file
                    if (fs.existsSync(infoJsonPath)) {
                        try {
                            const infoData = JSON.parse(fs.readFileSync(infoJsonPath, 'utf8'));
                            videoInfo.title = infoData.title || baseName;
                            videoInfo.duration = infoData.duration;
                            videoInfo.uploader = infoData.uploader || infoData.channel;
                            videoInfo.url = infoData.webpage_url || infoData.original_url;
                            videoInfo.thumbnail = infoData.thumbnail;
                            videoInfo.description = infoData.description;
                            videoInfo.viewCount = infoData.view_count;
                            videoInfo.uploadDate = infoData.upload_date;
                        } catch (jsonError) {
                            console.log(`Error reading info.json for ${file}:`, jsonError.message);
                        }
                    }

                    // Check videos.json for status and description (prioritize over file-based detection)
                    const videoJsonEntry = videosJsonData.videos.find(v => v.name === baseName);
                    if (videoJsonEntry) {
                        // Use status and description from videos.json
                        videoInfo.status = videoJsonEntry.status || videoInfo.status;
                        videoInfo.description = videoJsonEntry.description || videoInfo.description;
                    } else {
                        // Fallback: Determine video status based on processed files and folder
                        videoInfo.status = determineVideoStatus(baseName, directory.path, directory.name);
                    }

                    videos.push(videoInfo);
                }
            });
        });

        // Add archived videos (exist in videos.json but not in folders)
        if (videosJsonData.videos) {
            console.log(`🔍 Checking for archived videos from ${videosJsonData.videos.length} entries in videos.json`);
            
            videosJsonData.videos.forEach(jsonVideo => {
                // Check if this video already exists in our videos array (found in folders)
                const existsInFolders = videos.some(v => {
                    const baseName = path.basename(v.filename, path.extname(v.filename));
                    return baseName === jsonVideo.name;
                });
                
                console.log(`📹 Video "${jsonVideo.name}": ${existsInFolders ? 'Found in folders' : 'NOT found in folders (ARCHIVED)'}`);
                
                if (!existsInFolders) {
                    // This video exists in JSON but not in folders - it's archived
                    const archivedVideo = {
                        filename: `${jsonVideo.name}.mp4`, // Assume mp4 extension
                        filepath: null, // No file path since it doesn't exist
                        folder: 'archived', // Special folder designation
                        size: 0, // Unknown size
                        downloadDate: new Date(), // Use current date as fallback
                        title: jsonVideo.name,
                        duration: null,
                        uploader: null,
                        url: null,
                        thumbnail: null,
                        description: jsonVideo.description || '',
                        status: jsonVideo.status || 'archived', // Use original status, fallback to archived
                        viewCount: null,
                        uploadDate: null,
                        isArchived: true // Flag to identify archived videos
                    };
                    
                    console.log(`🗄️ Adding archived video: ${jsonVideo.name} (status: ${archivedVideo.status})`);
                    videos.push(archivedVideo);
                }
            });
        }

        // Sort by download date (newest first), but put archived videos at the end
        videos.sort((a, b) => {
            if (a.isArchived && !b.isArchived) return 1;
            if (!a.isArchived && b.isArchived) return -1;
            return new Date(b.downloadDate) - new Date(a.downloadDate);
        });

        return videos;
    } catch (error) {
        console.error('Error getting downloaded videos:', error);
        return [];
    }
}

/**
 * Format file size in human readable format
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted size string
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format duration from seconds to readable format
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration string
 */
function formatDuration(seconds) {
    if (!seconds) return 'Unknown';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
}

/**
 * Delete a video file and its associated metadata
 * @param {string} filename - Name of the video file to delete
 * @returns {boolean} Success status
 */
function deleteVideo(filename) {
    try {
        const filePath = path.join(uploadsDir, filename);
        const baseName = path.basename(filename, path.extname(filename));
        const infoJsonPath = path.join(uploadsDir, `${baseName}.info.json`);

        // Delete video file
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`Deleted video file: ${filename}`);
        }

        // Delete info.json file if it exists
        if (fs.existsSync(infoJsonPath)) {
            fs.unlinkSync(infoJsonPath);
            console.log(`Deleted info file: ${baseName}.info.json`);
        }

        return true;
    } catch (error) {
        console.error(`Error deleting video ${filename}:`, error);
        return false;
    }
}

/**
 * Get total storage used by downloaded videos
 * @returns {Object} Storage statistics
 */
function getStorageStats() {
    try {
        const videos = getDownloadedVideos();
        const totalSize = videos.reduce((sum, video) => sum + video.size, 0);
        
        return {
            totalVideos: videos.length,
            totalSize: totalSize,
            formattedSize: formatFileSize(totalSize)
        };
    } catch (error) {
        console.error('Error getting storage stats:', error);
        return {
            totalVideos: 0,
            totalSize: 0,
            formattedSize: '0 Bytes'
        };
    }
}

// ==================== API ROUTES ====================

// Get list of all downloaded videos
router.get('/videos', (req, res) => {
    try {
        console.log('📹 API: Getting list of downloaded videos...');
        
        const videos = getDownloadedVideos();
        const stats = getStorageStats();
        
        console.log(`📊 Found ${videos.length} videos, total size: ${stats.formattedSize}`);
        
        res.json({
            success: true,
            videos: videos,
            stats: stats,
            message: `Found ${videos.length} downloaded videos`
        });
    } catch (error) {
        console.error('❌ Error getting videos list:', error);
        res.status(500).json({
            success: false,
            message: error.message,
            videos: [],
            stats: { totalVideos: 0, totalSize: 0, formattedSize: '0 Bytes' }
        });
    }
});

// Delete a specific video
router.post('/videos/delete', (req, res) => {
    try {
        const { filename } = req.body;
        
        if (!filename) {
            return res.status(400).json({
                success: false,
                message: 'Filename is required'
            });
        }
        
        console.log(`🗑️ API: Deleting video: ${filename}`);
        
        const success = deleteVideo(filename);
        
        if (success) {
            console.log(`✅ Video deleted successfully: ${filename}`);
            res.json({
                success: true,
                message: `Video "${filename}" deleted successfully`
            });
        } else {
            console.log(`❌ Failed to delete video: ${filename}`);
            res.status(500).json({
                success: false,
                message: `Failed to delete video "${filename}"`
            });
        }
    } catch (error) {
        console.error('❌ Error deleting video:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Get storage statistics only
router.get('/videos/stats', (req, res) => {
    try {
        console.log('📊 API: Getting storage statistics...');
        
        const stats = getStorageStats();
        
        res.json({
            success: true,
            stats: stats
        });
    } catch (error) {
        console.error('❌ Error getting storage stats:', error);
        res.status(500).json({
            success: false,
            message: error.message,
            stats: { totalVideos: 0, totalSize: 0, formattedSize: '0 Bytes' }
        });
    }
});

// Get video info by filename
router.get('/videos/:filename', (req, res) => {
    try {
        const { filename } = req.params;
        console.log(`🔍 API: Getting info for video: ${filename}`);
        
        const videos = getDownloadedVideos();
        const video = videos.find(v => v.filename === filename);
        
        if (video) {
            res.json({
                success: true,
                video: video
            });
        } else {
            res.status(404).json({
                success: false,
                message: `Video "${filename}" not found`
            });
        }
    } catch (error) {
        console.error('❌ Error getting video info:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Reuse video - restart automation for processed videos
router.post('/videos/reuse', async (req, res) => {
    try {
        const { filename } = req.body;
        
        if (!filename) {
            return res.status(400).json({
                success: false,
                message: 'Filename is required'
            });
        }
        
        console.log(`🔄 API: Reusing video for automation: ${filename}`);
        
        // Determine correct folder based on video status from videos.json
        let videoFolder = 'downloads'; // default for processed videos
        let folderName = 'downloads';
        
        // Check videos.json for status to determine correct folder
        const videosJsonPath = path.join(__dirname, 'videos.json');
        if (fs.existsSync(videosJsonPath)) {
            try {
                const videosData = JSON.parse(fs.readFileSync(videosJsonPath, 'utf8'));
                const nameWithoutExtension = path.basename(filename, path.extname(filename));
                const videoData = videosData.videos?.find(v => v.name === nameWithoutExtension);
                
                if (videoData && videoData.status === 'downloaded') {
                    videoFolder = 'uploads';
                    folderName = 'uploads';
                }
            } catch (error) {
                console.warn('Could not read videos.json, using default folder logic');
            }
        }
        
        const targetDir = path.join(__dirname, videoFolder);
        const originalVideoPath = path.join(targetDir, filename);
        
        if (!fs.existsSync(originalVideoPath)) {
            return res.status(404).json({
                success: false,
                message: `Video "${filename}" not found in ${folderName} folder`
            });
        }
        
        // Create new filename with (1) suffix before reuse
        const fileExtension = path.extname(filename);
        const baseName = path.basename(filename, fileExtension);
        const newFilename = `${baseName}(1)${fileExtension}`;
        const newVideoPath = path.join(targetDir, newFilename);
        
        try {
            // Rename original video to add (1) suffix
            console.log(`📝 Renaming for reuse: ${filename} → ${newFilename}`);
            fs.renameSync(originalVideoPath, newVideoPath);
            console.log(`✅ Video renamed successfully for reuse automation`);
            
            // Update videos.json with the new filename
            const videosJsonPath = path.join(__dirname, 'videos.json');
            if (fs.existsSync(videosJsonPath)) {
                try {
                    const videosData = JSON.parse(fs.readFileSync(videosJsonPath, 'utf8'));
                    const nameWithoutExtension = path.basename(filename, path.extname(filename));
                    const newNameWithoutExtension = path.basename(newFilename, path.extname(newFilename));
                    
                    // Find and update the video entry
                    const videoIndex = videosData.videos?.findIndex(v => v.name === nameWithoutExtension);
                    if (videoIndex !== -1) {
                        videosData.videos[videoIndex].name = newNameWithoutExtension;
                        fs.writeFileSync(videosJsonPath, JSON.stringify(videosData, null, 2));
                        console.log(`📝 Updated videos.json: ${nameWithoutExtension} → ${newNameWithoutExtension}`);
                    }
                } catch (jsonError) {
                    console.warn('Could not update videos.json:', jsonError.message);
                }
            }
        } catch (renameError) {
            console.error(`❌ Failed to rename video for reuse:`, renameError.message);
            return res.status(500).json({
                success: false,
                message: `Failed to rename video for reuse: ${renameError.message}`
            });
        }
        
        // Import and start automation pipeline with the new copy
        const { runAutomationPipeline } = require('./timeline_test');
        
        console.log(`🔄 Starting automation pipeline for: ${newFilename}`);
        
        // Start automation in background using the new copy
        runAutomationPipeline(newVideoPath)
            .then(() => {
                console.log(`✅ Reuse automation completed for: ${filename}`);
            })
            .catch((error) => {
                console.error(`❌ Reuse automation failed for ${filename}:`, error.message);
            });
        
        res.json({
            success: true,
            message: `Automation started for "${filename}"`
        });
        
    } catch (error) {
        console.error('❌ Error reusing video:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ==================== EXPORTS ====================

module.exports = {
    // Core functions
    getDownloadedVideos,
    formatFileSize,
    formatDuration,
    deleteVideo,
    getStorageStats,
    updateVideoStatus,
    // Express router for API routes
    router
};
