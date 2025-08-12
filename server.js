const express = require('express');
const path = require('path');
const fs = require('fs');
const uploadRouter = require('./upload');
const { router: videosRouter } = require('./videos');
const { downloadYouTubeVideo, getVideoInfo } = require('./youtube-downloader');
require('dotenv').config();

const app = express();
const port = 3000;

// --- Middleware ---
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// --- API Routes ---

// Serve videos.json file
app.get('/videos.json', (req, res) => {
    const videosJsonPath = path.join(__dirname, 'videos.json');
    if (fs.existsSync(videosJsonPath)) {
        res.sendFile(videosJsonPath);
    } else {
        res.json({ videos: [] }); // Return empty array if file doesn't exist
    }
});

// Server-Sent Events for progress updates
const progressClients = new Set();

app.get('/progress', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });
    
    progressClients.add(res);
    
    req.on('close', () => {
        progressClients.delete(res);
    });
});

// Function to broadcast progress to all connected clients
function broadcastProgress(message) {
    const data = `data: ${JSON.stringify({ message, timestamp: new Date().toISOString() })}\n\n`;
    progressClients.forEach(client => {
        try {
            client.write(data);
        } catch (err) {
            progressClients.delete(client);
        }
    });
}

// Make broadcastProgress available globally
global.broadcastProgress = broadcastProgress;

// Use the upload router for /upload POST requests
app.use('/upload', uploadRouter);

// Use the videos router for /api/videos requests
app.use('/api', videosRouter);

// Serve the videos page
app.get('/videos', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'videos.html'));
});

// YouTube download routes
app.post('/youtube/info', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) {
            return res.status(400).json({ success: false, message: 'YouTube URL is required' });
        }

        broadcastProgress('🔍 Getting video information...');
        const videoInfo = await getVideoInfo(url);
        
        res.json({ 
            success: true, 
            info: videoInfo 
        });
    } catch (error) {
        console.error('Error getting video info:', error);
        broadcastProgress(`❌ Error: ${error.message}`);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

app.post('/youtube/download', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) {
            return res.status(400).json({ success: false, message: 'YouTube URL is required' });
        }

        broadcastProgress('🚀 Starting YouTube video download...');
        
        // Download the video with progress updates
        const downloadedPath = await downloadYouTubeVideo(url, (progress) => {
            broadcastProgress(progress);
        });

        // Start automation pipeline after download
        broadcastProgress('📤 Starting CapCut automation pipeline...');
        console.log('🔍 DEBUG: Downloaded file path:', downloadedPath);
        console.log('🔍 DEBUG: File exists:', fs.existsSync(downloadedPath));
        
        // Check editor availability before starting
        const editorsPath = path.join(__dirname, 'editors.json');
        const editors = JSON.parse(fs.readFileSync(editorsPath, 'utf-8'));
        const availableEditors = editors.filter(editor => editor.status === 'available');
        console.log('🔍 DEBUG: Available editors:', availableEditors.length, '/', editors.length);
        
        if (availableEditors.length === 0) {
            console.log('❌ DEBUG: No editors available! This will block automation.');
            console.log('📊 DEBUG: Editor statuses:', editors.map(e => ({url: e.url.substring(0, 50) + '...', status: e.status})));
        }
        
        // Import and run the automation
        console.log('🚀 DEBUG: About to call runAutomationPipeline...');
        const { runAutomationPipeline } = require('./timeline_test');
        await runAutomationPipeline(downloadedPath);
        
        res.json({ 
            success: true, 
            message: 'Video downloaded and automation started',
            filePath: downloadedPath
        });
    } catch (error) {
        console.error('Error downloading video:', error);
        broadcastProgress(`❌ Download failed: ${error.message}`);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Status check now checks the filesystem for the puppeteer_data directory.
app.get('/status', (req, res) => {
    const puppeteerDataPath = path.join(__dirname, 'puppeteer_data');
    const isLoggedIn = fs.existsSync(puppeteerDataPath);
    console.log(`Checking for login status via filesystem. Path: '${puppeteerDataPath}'. Found: ${isLoggedIn}`);
    res.json({ loggedIn: isLoggedIn });
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }
    // Login functionality removed - automation now handles login via persistent user data
    res.json({ success: true, message: 'Login handled via persistent browser session.' });
});

app.post('/create-video', async (req, res) => {
    const { videoPath } = req.body;
    if (!videoPath) {
        return res.status(400).json({ success: false, message: 'Video path is required.' });
    }
    // Video creation now handled via upload route with automation pipeline
    res.json({ success: true, message: 'Use /upload endpoint for video processing.' });
});

// --- Server Start ---
const server = app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
    console.log('Open your browser and navigate to the URL to start.');
});

// --- Graceful Shutdown ---
async function gracefulShutdown() {
    console.log('\nShutting down gracefully...');
    server.close(() => {
        console.log('Server has been shut down.');
        process.exit(0);
    });
}

// Listen for SIGINT (Ctrl+C)
process.on('SIGINT', gracefulShutdown);

// Listen for other termination signals
process.on('SIGTERM', gracefulShutdown);
