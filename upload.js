const express = require('express');
const multer = require('multer');
const path = require('path');
const router = express.Router();
const { runAutomationPipeline } = require('./timeline_test'); // Import the timeline automation

// Configure storage for multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/') // Files will be saved in the 'uploads' directory
    },
    filename: function (req, file, cb) {
        // Create a unique filename to avoid overwriting
        cb(null, Date.now() + path.extname(file.originalname))
    }
});

const upload = multer({ storage: storage });

// Define the upload route and trigger automation
router.post('/', upload.single('video'), async (req, res) => {
    // Check editor availability BEFORE allowing upload
    const fs = require('fs');
    const editorsPath = path.join(__dirname, 'editors.json');
    
    try {
        const editors = JSON.parse(fs.readFileSync(editorsPath, 'utf-8'));
        const availableEditors = editors.filter(editor => editor.status === 'available');
        const inUseEditors = editors.filter(editor => editor.status === 'in-use');
        
        if (availableEditors.length === 0) {
            console.log('❌ Upload blocked: No editors available for automation');
            console.log(`📊 Editor Status: ${inUseEditors.length} in-use, 0 available`);
            console.log('📝 Tip: Wait for current automation to finish or add more editors');
            
            return res.status(423).json({ // 423 = Locked
                success: false,
                message: 'All editors are currently busy. Please wait for current automation to finish before uploading new videos.',
                editorStatus: {
                    available: availableEditors.length,
                    inUse: inUseEditors.length,
                    total: editors.length
                }
            });
        }
        
        console.log(`✅ Upload allowed: ${availableEditors.length}/${editors.length} editors available`);
        
    } catch (error) {
        console.error('❌ Error reading editor status:', error.message);
        return res.status(500).json({ 
            success: false, 
            message: 'Unable to check editor availability. Please try again.' 
        });
    }
    
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    const absoluteFilePath = path.resolve(req.file.path);
    console.log(`File successfully uploaded to: ${absoluteFilePath}`);

    try {
        console.log('📼 Starting CapCut automation pipeline...');
        console.log('🔍 DEBUG: File path:', absoluteFilePath);
        console.log('🔍 DEBUG: File exists:', require('fs').existsSync(absoluteFilePath));
        
        // Check editor availability before starting
        const editorsPath = require('path').join(__dirname, 'editors.json');
        const editors = JSON.parse(require('fs').readFileSync(editorsPath, 'utf-8'));
        const availableEditors = editors.filter(editor => editor.status === 'available');
        console.log('🔍 DEBUG: Available editors:', availableEditors.length, '/', editors.length);
        
        if (availableEditors.length === 0) {
            console.log('❌ DEBUG: No editors available! This will block automation.');
            console.log('📊 DEBUG: Editor statuses:', editors.map(e => ({url: e.url.substring(0, 50) + '...', status: e.status})));
        }
        
        console.log('🚀 DEBUG: About to call runAutomationPipeline...');
        await runAutomationPipeline(absoluteFilePath);
        
        console.log('🎉 CapCut automation pipeline completed successfully!');
        
        // Update video status from 'filed' to 'rmbg' after successful automation
        try {
            const { updateVideoStatus } = require('./videos');
            const videoFileName = path.basename(absoluteFilePath);
            await updateVideoStatus(videoFileName, 'rmbg');
            console.log(`📝 Updated video status to 'rmbg' for: ${videoFileName}`);
        } catch (statusError) {
            console.log('⚠️ Could not update video status:', statusError.message);
        }
        
        res.json({
            success: true,
            message: 'File uploaded and CapCut automation pipeline completed successfully!',
            filePath: absoluteFilePath
        });
    } catch (error) {
        // Enhanced error logging based on error type
        if (error.message.includes('No editors available')) {
            console.log('⚠️ Automation blocked: All editors are currently busy');
            console.log('📝 Tip: Wait for current automation to finish or add more editors');
        } else {
            console.log('❌ Automation pipeline failed:', error.message);
        }
        
        res.status(500).json({
            success: false,
            message: error.message.includes('No editors available') 
                ? 'All editors are currently busy. Please wait and try again.'
                : `Automation failed: ${error.message}`
        });
    }
});

module.exports = router;
