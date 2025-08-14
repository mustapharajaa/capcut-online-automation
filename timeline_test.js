const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const { setTimeout } = require('timers/promises');
const TimelineUtils = require('./timelineUtils');
const { updateVideoStatusInJson } = require('./videos');

// Progress broadcasting function
function broadcastProgress(message) {
    console.log(message);
    if (global.broadcastProgress) {
        global.broadcastProgress(message);
    }
}

// Try multiple common Chrome paths
const POSSIBLE_CHROME_PATHS = [
    '/usr/bin/google-chrome', // Standard Linux path
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', // Standard Windows path
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', // 32-bit Windows path
    process.env.CHROME_PATH, // Allow override via environment variable
    null // Let Puppeteer find Chrome automatically
];

// Find the first valid Chrome path
const BROWSER_EXECUTABLE_PATH = POSSIBLE_CHROME_PATHS.find(path => {
    if (!path) return false;
    try {
        return require('fs').existsSync(path);
    } catch {
        return false;
    }
}) || null; // Use null to let Puppeteer auto-detect
const USER_DATA_DIR = path.join(__dirname, 'puppeteer_data');
const DEBUG_DIR = path.join(__dirname, 'debug');
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

// Global browser instance ONLY for automation pipeline reuse
let automationBrowser = null;

// Editor tab management functions
async function updateEditorStatus(url, status) {
    const editorsPath = path.join(__dirname, 'editors.json');
    try {
        let editors = [];
        if (fs.existsSync(editorsPath)) {
            const data = fs.readFileSync(editorsPath, 'utf8');
            editors = JSON.parse(data);
        }
        
        // Find and update the editor with matching URL
        const editorIndex = editors.findIndex(editor => editor.url === url);
        if (editorIndex !== -1) {
            editors[editorIndex].status = status;
            fs.writeFileSync(editorsPath, JSON.stringify(editors, null, 4));
            console.log(`📝 Updated editor status to: ${status}`);
        }
    } catch (error) {
        console.error('Error updating editor status:', error.message);
    }
}

async function closeEditorTab(browser, page) {
    try {
        const currentUrl = page.url();
        console.log(`🗑️ Closing editor tab: ${currentUrl}`);
        
        // Update status to available before closing
        await updateEditorStatus(currentUrl, 'available');
        
        // Close the specific tab
        await page.close();
        
        broadcastProgress('🗑️ Editor tab closed, browser ready for next automation');
        console.log('✅ Editor tab closed successfully');
    } catch (error) {
        console.error('Error closing editor tab:', error.message);
    }
}

if (!fs.existsSync(DEBUG_DIR)) {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
}
if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

async function uploadVideo(page, filePath) {
    broadcastProgress(`📤 Starting upload process for: ${path.basename(filePath)}`);

    try {
        // 1. Click the main 'Upload' button in the left-hand menu
        const uploadButtonSelector = 'span[data-ssr-i18n-key="uploa_web_d"]';
        console.log('Waiting for the main Upload button...');
        await page.waitForSelector(uploadButtonSelector, { visible: true, timeout: 30000 });
        console.log('Clicking the main Upload button...');
        await page.click(uploadButtonSelector);

        // 2. Initiate the file chooser
        console.log('Waiting for the file chooser to open...');
        const [fileChooser] = await Promise.all([
            page.waitForFileChooser({ timeout: 10000 }),
            // This is a robust way to click the 'Upload' button inside the panel
            page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('span'));
                const uploadFileButton = buttons.find(el => el.textContent.trim() === 'Upload file');
                if (uploadFileButton) {
                    uploadFileButton.click();
                } else {
                    // Fallback for different structures
                    const uploadArea = document.querySelector('div[class*="upload-item-content"]');
                    if (uploadArea) uploadArea.click();
                    else throw new Error('Could not find the \'Upload file\' button or area.');
                }
            })
        ]);

        // 3. Accept the file
        console.log(`Accepting file: ${filePath}`);
        await fileChooser.accept([filePath]);

        // 4. Wait for upload and transcoding to complete by tracking the UI state
        const fileName = path.basename(filePath);
        console.log(`File '${fileName}' accepted. Now monitoring UI for upload status...`);

        // --- WAIT FOR VIDEO FILENAME IN MEDIA PANEL ---
        console.log('--- Waiting for editor UI to load... ---');
        const videoFileName = path.basename(filePath);
        console.log(`Waiting for the uploaded video "${videoFileName}" to appear in the media list...`);

        // Use XPath to find any element on the page that contains the video's file name
        const videoElementXPath = `//div[contains(@class, 'card-item-label') and text()='${videoFileName}']`;
        const videoTextElement = await page.waitForSelector(`xpath/${videoElementXPath}`, { timeout: 600000 }); // Wait up to 10 minutes
        console.log(`Successfully found the video "${videoFileName}" in the media panel!`);

        // Get the parent element, which should be the container for the media item
        const mediaItemContainer = await videoTextElement.evaluateHandle(node => node.parentElement);

        // --- UPLOAD COMPLETION LOGIC ---
        console.log('Now waiting for the upload & transcode to complete.');
        console.log('This will be detected by waiting for the status overlay to disappear.');

        // The status overlay has a class like 'status-mask-oGLro1'. We can look for a div with a class containing 'status-mask'
        const statusOverlaySelector = 'div[class*="status-mask"]';

        await mediaItemContainer.evaluate((node, selector) => {
            return new Promise((resolve, reject) => {
                const checkInterval = 1000; // Check every second
                const timeout = 960000; // 16 minutes timeout for long videos
                let elapsedTime = 0;

                const intervalId = setInterval(() => {
                    const overlay = node.querySelector(selector);
                    if (!overlay) {
                        // If the element is gone entirely, that also counts as success
                        clearInterval(intervalId);
                        resolve();
                        return;
                    }

                    const rect = overlay.getBoundingClientRect();
                    // The upload is complete when the overlay has no size
                    if (rect.width === 0 && rect.height === 0) {
                        clearInterval(intervalId);
                        resolve();
                        return;
                    }

                    elapsedTime += checkInterval;
                    if (elapsedTime >= timeout) {
                        clearInterval(intervalId);
                        reject(new Error('Timed out waiting for upload to complete. The status overlay remained visible.'));
                    }
                }, checkInterval);
            });
        }, statusOverlaySelector);

        broadcastProgress(`✅ SUCCESS: Video "${videoFileName}" uploaded and transcoded!`);

        // --- Add video to timeline ---
        console.log('Getting a fresh handle to the media item...');
        const freshVideoTextElement = await page.waitForSelector(`xpath/${videoElementXPath}`, { timeout: 10000 });
        const freshMediaItemContainer = await freshVideoTextElement.evaluateHandle(node => node.parentElement);

        console.log('Clicking the media item to add it to the timeline...');
        const mediaItemElement = await freshMediaItemContainer.asElement();
        await mediaItemElement.click();
        
        broadcastProgress('🎬 Successfully added video to the timeline!');
        
        // Change project name to match uploaded filename
        try {
            const originalFileName = path.basename(filePath, path.extname(filePath));
            broadcastProgress(`📝 Changing project name to: ${originalFileName}`);
            
            // Try to find and click the project name element
            const projectNameSelectors = [
                'div.draft-input__read-only',
                '//*[@id="workbench"]/div[2]/div[1]/div[1]/div[2]/div/div/div/div[3]/div'
            ];
            
            let projectNameElement = null;
            for (const selector of projectNameSelectors) {
                try {
                    if (selector.startsWith('//')) {
                        // XPath selector
                        projectNameElement = await page.waitForSelector(`xpath/${selector}`, { timeout: 3000 });
                    } else {
                        // CSS selector
                        projectNameElement = await page.waitForSelector(selector, { timeout: 3000 });
                    }
                    if (projectNameElement) {
                        console.log(`Found project name element using: ${selector}`);
                        break;
                    }
                } catch (err) {
                    console.log(`Project name selector ${selector} failed:`, err.message);
                }
            }
            
            if (projectNameElement) {
                // Click on the project name to edit it
                await projectNameElement.click();
                await setTimeout(500);
                
                // Select all and replace with new name
                await page.keyboard.down('Control');
                await page.keyboard.press('KeyA');
                await page.keyboard.up('Control');
                await setTimeout(200);
                
                await page.keyboard.type(originalFileName);
                await setTimeout(300);
                
                // Press Enter to confirm
                await page.keyboard.press('Enter');
                await setTimeout(1000);
                
                broadcastProgress(`✅ Project name changed to: ${originalFileName}`);
                
                // Wait 37 seconds for CapCut UI to fully stabilize after project name change
                console.log('⏳ Waiting 37 seconds for UI to stabilize after project name change...');
                await setTimeout(37000);
                console.log('✅ UI stabilization wait complete');
                
            } else {
                broadcastProgress(`⚠️ Could not find project name element to change`);
            }
        } catch (nameError) {
            console.log('Could not change project name:', nameError.message);
            broadcastProgress(`⚠️ Failed to change project name: ${nameError.message}`);
        }
        
    } catch (error) {
        console.error(`Error: Could not find the video "${path.basename(filePath)}" in the media panel.`);
        console.error('The upload may have failed or the UI structure has changed.');
        await page.screenshot({ path: path.join(DEBUG_DIR, 'debug_screenshot_upload_failed.png') });
        console.log('A screenshot has been saved for debugging.');
        throw error;
    }
}

async function moveToTrack2(page) {
    console.log('Preparing to move clip to Track 2...');
    await setTimeout(6000);
    
    // Debug screenshots removed per user request
    
    // Try to find the video clip in the timeline
    const clipSelector = 'div[data-testid="timeline-clip"]';
    let clipBox = null;
    
    try {
        console.log('Looking for video clip in timeline...');
        await page.waitForSelector(clipSelector, { timeout: 10000 });
        
        // Get the first clip's position
        clipBox = await page.evaluate((selector) => {
            const clip = document.querySelector(selector);
            if (!clip) return null;
            const rect = clip.getBoundingClientRect();
            return {
                x: rect.left + (rect.width / 2), // Center of clip
                y: rect.top + (rect.height / 2), // Center of clip
                width: rect.width,
                height: rect.height
            };
        }, clipSelector);
    } catch (error) {
        console.log('Could not find clip with selector, trying fallback...');
    }
    
    // If we couldn't find the clip with the selector, try to calculate position
    if (!clipBox) {
        console.log('Using fallback position calculation...');
        const canvasSelector = 'div.konvajs-content canvas';
        await page.waitForSelector(canvasSelector, { timeout: 30000 });
        
        const canvasBox = await page.evaluate(selector => {
            const canvas = document.querySelector(selector);
            if (!canvas) return null;
            const rect = canvas.getBoundingClientRect();
            return {
                x: rect.left,
                y: rect.top,
                width: rect.width,
                height: rect.height
            };
        }, canvasSelector);
        
        if (!canvasBox) throw new Error('Could not find timeline canvas');
        
        // Calculate clip position (start of timeline)
        clipBox = {
            x: canvasBox.x + 100, // Slightly in from left
            y: canvasBox.y + (canvasBox.height * 0.5), // Middle of track 1
            width: 100,
            height: 50
        };
    }
    
    console.log('Clip position:', clipBox);
    
    // Calculate track positions (assuming each track is about 50px tall)
    const trackHeight = 50;
    const track1Y = clipBox.y;
    const track2Y = track1Y - trackHeight;
    
    console.log(`Moving from Track 1 (${track1Y}) to Track 2 (${track2Y})`);
    
    // Move to clip, click, and drag up one track
    await page.mouse.move(clipBox.x, track1Y);
    await page.mouse.down();
    await setTimeout(500); // Hold for a bit longer
    
    // Move up to Track 2
    await page.mouse.move(clipBox.x, track2Y, { steps: 10 });
    await setTimeout(200);
    
    // Move slightly to the right to ensure the drop is registered
    await page.mouse.move(clipBox.x + 10, track2Y, { steps: 5 });
    await page.mouse.up();
    
    console.log('Mouse movement completed, waiting for UI to update...');
    await setTimeout(2000);
    
    // Debug screenshot removed per user request
    
    broadcastProgress('📍 SUCCESS: Clip moved to Track 2!');
}

async function runAutomationPipeline(videoPath) {
    let browser = null;
    let editorUrl = null;
    
    try {
        broadcastProgress('🚀 Starting CapCut automation pipeline...');
        
        // Read editor info and check availability
        const editorsPath = path.join(__dirname, 'editors.json');
        const editors = JSON.parse(fs.readFileSync(editorsPath, 'utf-8'));
        
        // Check if any editors are available
        const availableEditors = editors.filter(editor => editor.status === 'available');
        if (availableEditors.length === 0) {
            const inUseCount = editors.filter(editor => editor.status === 'in-use').length;
            console.log('❌ No editors available for automation');
            console.log(`📊 Status: ${inUseCount} in-use, ${editors.length - inUseCount} other`);
            broadcastProgress('❌ No editors available. All editors are currently in-use.');
            throw new Error('No editors available for automation. All editors are currently in-use.');
        }
        
        // Use the first available editor
        const selectedEditor = availableEditors[0];
        editorUrl = selectedEditor.url;
        console.log(`✅ Found available editor (${availableEditors.length}/${editors.length} available)`);
        
        // Set editor status to in-use
        await updateEditorStatus(editorUrl, 'in-use');
        
        // Check if we can reuse existing automation browser
        if (automationBrowser && automationBrowser.isConnected()) {
            try {
                await automationBrowser.version();
                console.log('♻️ Reusing existing automation browser');
                broadcastProgress('♻️ Reusing existing automation browser');
                browser = automationBrowser;
            } catch (error) {
                console.log('Existing automation browser not responsive, creating new one...');
                automationBrowser = null;
            }
        }
        
        // Launch new browser if needed
        if (!browser) {
            broadcastProgress('🌐 Launching browser for automation pipeline...');
            
            // Debug Chrome path detection
            console.log('🔍 Chrome path detection:');
            console.log(`   Found Chrome at: ${BROWSER_EXECUTABLE_PATH || 'Auto-detect mode'}`);
            
            const launchOptions = {
                userDataDir: USER_DATA_DIR,
                headless: false, // Set to false to see the browser on your PC
                args: [
                    '--start-maximized',
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox' // Required for running as root on Linux
                ],
                protocolTimeout: 1200000 // 20 minutes timeout for long video processing
            };
            
            // Only set executablePath if we found a valid Chrome path
            if (BROWSER_EXECUTABLE_PATH) {
                launchOptions.executablePath = BROWSER_EXECUTABLE_PATH;
            }
            
            browser = await puppeteer.launch(launchOptions);
            automationBrowser = browser;
        }

        const page = await browser.newPage();
        const client = await browser.target().createCDPSession();
        await client.send('Browser.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: DOWNLOADS_DIR,
            eventsEnabled: true,
        });

        await page.setViewport({ width: 1280, height: 720 });

        console.log('Navigating to CapCut editor...');
        await page.goto(editorUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        broadcastProgress('✅ Page loaded successfully!');

        // --- UPLOAD AND ARRANGE ---
        if (!fs.existsSync(videoPath)) {
            throw new Error(`Video file not found at ${videoPath}. Please ensure it was uploaded correctly.`);
        }
        await uploadVideo(page, videoPath);

        // Zoom in 5 times before timeline canvas click for better precision
        try {
            console.log('Zooming in timeline 5 times before timeline canvas click...');
            // Use evaluate to find and click the zoom-in button (5th button in timeline tools)
            
            for (let i = 0; i < 5; i++) {
                const clicked = await page.evaluate(() => {
                    // Find the timeline tools container
                    const timelineTools = document.querySelector('#timeline-part-view .timeline-tools-right');
                    if (!timelineTools) return false;
                    
                    // Get all buttons in the timeline tools
                    const buttons = timelineTools.querySelectorAll('button');
                    
                    // The 5th button should be the zoom-in button (index 4)
                    const zoomInButton = buttons[4]; // 5th button (0-indexed)
                    if (zoomInButton) {
                        zoomInButton.click();
                        return true;
                    }
                    return false;
                });
                
                if (clicked) {
                    console.log(`✅ Zoom-in click ${i + 1}/5`);
                    await setTimeout(300); // Small delay between clicks
                } else {
                    throw new Error('Zoom-in button not found in timeline tools');
                }
            }
            console.log('✅ Timeline zoomed in 5 times successfully');
            await setTimeout(1000); // Wait for zoom to settle
        } catch (error) {
            console.log('⚠️ Could not zoom in timeline, continuing anyway:', error.message);
        }
        
        // Click timeline canvas after project name change
        try {
            console.log('Clicking timeline canvas after project name change...');
            const timelineCanvasSelectors = [
                'div#timeline > div:nth-child(2) > span > span > div > div.timeline-scroll-wrap > div.timeline-bd-vertical-scroll-icatUb > div.timeline-large-container > div[role=presentation] > canvas',
                'div.timeline-large-container > div[role=presentation] > canvas',
                'div.timeline-scroll-wrap canvas',
                'div.konvajs-content canvas',
                '#timeline canvas'
            ];
            
            let canvasClicked = false;
            for (const selector of timelineCanvasSelectors) {
                try {
                    await page.waitForSelector(selector, { visible: true, timeout: 3000 });
                    await page.click(selector);
                    console.log(`✅ Successfully clicked timeline canvas with selector: ${selector}`);
                    canvasClicked = true;
                    break;
                } catch (e) {
                    console.log(`⚠️ Timeline canvas selector failed: ${selector}`);
                }
            }
            
            if (!canvasClicked) {
                // Fallback: Use XPath
                console.log('Trying XPath fallback for timeline canvas...');
                try {
                    const xpathSelector = '//html[1]/body[1]/div[2]/div[1]/div[1]/div[2]/div[2]/div[1]/div[2]/div[1]/div[1]/div[1]/div[3]/div[1]/div[2]/span[1]/span[1]/div[1]/div[2]/div[3]/div[2]/div[1]/canvas[1]';
                    const [canvasElement] = await page.$x(xpathSelector);
                    if (canvasElement) {
                        await canvasElement.click();
                        console.log('✅ Successfully clicked timeline canvas using XPath');
                        canvasClicked = true;
                    }
                } catch (xpathError) {
                    console.log('⚠️ XPath timeline canvas click failed:', xpathError.message);
                }
            }
            
            if (canvasClicked) {
                await setTimeout(1000); // Wait for canvas interaction to register
                broadcastProgress('✅ Timeline canvas clicked after project name change');
            } else {
                console.log('⚠️ Could not click timeline canvas, continuing anyway...');
            }
            
        } catch (error) {
            console.log('⚠️ Timeline canvas click error:', error.message);
        }
        
        await moveToTrack2(page);

        // --- TIMELINE EDITING ---
        broadcastProgress('⏯️ Moving playhead to start and beginning timeline edits...');
        // Move playhead to the beginning by clicking at the start of the timeline
        const timelineRect = await page.evaluate(() => {
            const timeline = document.querySelector('#timeline-part-view');
            if (timeline) {
                const rect = timeline.getBoundingClientRect();
                return {
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height
                };
            }
            return null;
        });
        
        if (timelineRect) {
            const clickX = timelineRect.left + 50; // Click near the beginning
            const clickY = timelineRect.top + (timelineRect.height / 2);
            console.log(`Clicking timeline at position: ${clickX}, ${clickY}`);
            await page.mouse.click(clickX, clickY);
            await setTimeout(1000);
            console.log('Playhead moved to beginning');
        } else {
            console.error('Timeline element not found!');
        }

        console.log('Zooming out the timeline 7 times using the correct selector...');
        try {
            const zoomOutButtonSelector = '#timeline-part-view > div.timeline-tools-wrapper > div.timeline-tools > div.timeline-tools-right > button:nth-child(4)';
            await page.waitForSelector(zoomOutButtonSelector, { timeout: 10000 });
            console.log('Zoom-out button found. Clicking 7 times...');
            for (let i = 0; i < 7; i++) {
                await page.click(zoomOutButtonSelector);
                await setTimeout(250); // Wait for UI to update
            }
            console.log('Timeline zoomed out successfully.');
        } catch (e) {
            console.error('Could not find or click the zoom-out button with the new selector.', e.message);
        }

        // --- CONTINUE WITH TIMELINE EDITING ---
        broadcastProgress('✂️ Starting timeline editing automation...');
        
        // Get canvas for timeline operations
        const canvasSelector = 'div.konvajs-content canvas';
        const targetDuration = 30; // 30 seconds
        console.log(`Setting fixed duration to: ${targetDuration} seconds`);
        
        const canvasBox = await page.evaluate(selector => {
            const canvas = document.querySelector(selector);
            if (!canvas) return null;
            const rect = canvas.getBoundingClientRect();
            const timelineEl = document.getElementById('timeline');
            const trackTopStyle = getComputedStyle(timelineEl).getPropertyValue('--main-track-top');
            const trackTop = parseInt(trackTopStyle, 10) || 87;
            return { 
                x: rect.x, 
                y: rect.y, 
                width: rect.width, 
                height: rect.height,
                trackTop: trackTop
            };
        }, canvasSelector);

        if (!canvasBox) {
            throw new Error('Could not find timeline canvas.');
        }

        console.log('Canvas found at:', canvasBox);
        console.log('Waiting 5 seconds for clip selection...');
        await setTimeout(5000);

        // Get video duration and move to end
        const videoDuration = await page.evaluate(() => {
            const timeDisplay = document.querySelector('.player-time');
            if (timeDisplay) {
                const timeStr = timeDisplay.textContent.trim().split(' / ')[1];
                if (timeStr) {
                    const [h, m, s] = timeStr.split(':').map(Number);
                    return (h * 3600) + (m * 60) + s;
                }
            }
            return 30;
        });
        
        console.log(`Video duration: ${videoDuration} seconds`);
        
        // Click at the last second of the video
        const clickPosition = await page.evaluate((duration) => {
            const timeline = document.querySelector('#timeline-part-view');
            if (!timeline) return null;
            
            const rect = timeline.getBoundingClientRect();
            const totalWidth = rect.width;
            const position = (duration > 0 ? (duration - 1) / duration : 0.99) * totalWidth;
            const clickX = rect.left + position;
            const clickY = rect.top + (rect.height / 2);
            
            return { x: clickX, y: clickY };
        }, videoDuration);
        
        if (clickPosition) {
            console.log(`Clicking at position: ${clickPosition.x}, ${clickPosition.y}`);
            await page.mouse.click(clickPosition.x, clickPosition.y);
            await setTimeout(500);
        }

        // Click on image element to select it for resize
        console.log('Clicking on image element to select it for resize...');
        const imageClickX = canvasBox.x + 20; // Click on image area (moved even further left to 20)
        const imageClickY = canvasBox.y + canvasBox.trackTop + 25;
        await page.mouse.click(imageClickX, imageClickY);
        await setTimeout(1000);
        console.log('Image element clicked and selected.');

        // Scan for resize handle and drag
        console.log('🔍 Starting enhanced resize handle detection...');
        console.log(`📍 Image was clicked at: X=${imageClickX}, Y=${imageClickY}`);
        
        const centerVerticalPosition = canvasBox.y + canvasBox.trackTop + 25;
        const verticalScanRadius = 25; // Increased scan radius
        let resizeHandleX = -1;
        let resizeHandleY = -1;
        
        // Expand scan area to cover more of the timeline
        const startScanX = Math.round(canvasBox.x + 10); // Start closer to left edge
        const endScanX = Math.round(canvasBox.x + canvasBox.width - 10); // Scan almost full width
        
        console.log(`🔍 Scanning area: X from ${startScanX} to ${endScanX}, Y from ${centerVerticalPosition - verticalScanRadius} to ${centerVerticalPosition + verticalScanRadius}`);
        console.log(`📏 Total scan width: ${endScanX - startScanX}px, height: ${verticalScanRadius * 2}px`);

        scanLoop: for (let x = startScanX; x < endScanX; x += 5) {
            for (let y = centerVerticalPosition - verticalScanRadius; y <= centerVerticalPosition + verticalScanRadius; y += 5) {
                await page.mouse.move(x, y, { steps: 1 });
                await setTimeout(10);
                let cursor = await page.evaluate(selector => document.querySelector(selector) ? getComputedStyle(document.querySelector(selector)).cursor : '', canvasSelector);

                if (cursor.includes('col-resize')) {
                    console.log(`Resize handle area found at X=${x}. Pinpointing exact edge...`);
                    resizeHandleY = y;
                    let currentX = x;
                    while(cursor.includes('col-resize') && currentX < endScanX) {
                        resizeHandleX = currentX;
                        currentX++;
                        await page.mouse.move(currentX, resizeHandleY, { steps: 1 });
                        await setTimeout(10);
                        cursor = await page.evaluate(selector => document.querySelector(selector) ? getComputedStyle(document.querySelector(selector)).cursor : '', canvasSelector);
                    }
                    console.log(`SUCCESS: True edge pinpointed at X=${resizeHandleX}, Y=${resizeHandleY}`);
                    break scanLoop;
                }
            }
        }

        if (resizeHandleX === -1) {
            console.error('ERROR: Could not find resize handle.');
            await page.screenshot({ path: path.join(DEBUG_DIR, 'resize_handle_not_found.png') });
        } else {
            // Calculate drag distance and perform drag
            const PIXELS_PER_SECOND = 30;
            const currentImageWidthInPixels = resizeHandleX - canvasBox.x;
            const targetWidthInPixels = targetDuration * PIXELS_PER_SECOND;
            const dragDistance = Math.round(targetWidthInPixels - currentImageWidthInPixels);

            if (dragDistance > 0) {
                console.log(`Dragging ${dragDistance}px to extend the clip`);
                const targetX = resizeHandleX + dragDistance;
                await page.mouse.move(resizeHandleX, resizeHandleY);
                await setTimeout(100);
                await page.mouse.down();
                await setTimeout(100);
                await page.mouse.move(targetX, resizeHandleY, { steps: 20 });
                await setTimeout(100);
                await page.mouse.up();
                console.log('Drag complete. Clip duration adjusted.');
            }
        }

        // Click Split button and continue automation
        try {
            // Enhanced Split button logic with multiple fallbacks
            let splitSuccess = false;
            console.log('✂️ Attempting to click the Split button with enhanced fallback logic...');
            
            // Multiple Split button selectors to try
            const splitButtonSelectors = [
                '#timeline-part-view > div.timeline-tools-wrapper > div.timeline-tools > div.timeline-tools-left > button:nth-child(1)',
                '.timeline-tools-left > button:first-child',
                '.timeline-tools-left button[title*="Split"]',
                '.timeline-tools-left button[aria-label*="Split"]',
                'button[data-testid="split-button"]',
                '.timeline-tools button:first-child'
            ];
            
            // Try each selector
            for (let i = 0; i < splitButtonSelectors.length && !splitSuccess; i++) {
                try {
                    console.log(`🔍 Trying Split button selector ${i + 1}/${splitButtonSelectors.length}: ${splitButtonSelectors[i]}`);
                    await page.waitForSelector(splitButtonSelectors[i], { visible: true, timeout: 3000 });
                    await page.click(splitButtonSelectors[i]);
                    console.log(`✅ Successfully clicked Split button with selector ${i + 1}`);
                    splitSuccess = true;
                    break;
                } catch (selectorError) {
                    console.log(`⚠️ Split button selector ${i + 1} failed: ${selectorError.message}`);
                }
            }
            
            // Keyboard shortcut fallback if all selectors fail
            if (!splitSuccess) {
                console.log('🎹 All Split button selectors failed. Trying keyboard shortcut (S key)...');
                try {
                    await page.keyboard.press('KeyS');
                    await setTimeout(500);
                    console.log('✅ Successfully used keyboard shortcut (S) for Split');
                    splitSuccess = true;
                } catch (keyboardError) {
                    console.log(`❌ Keyboard shortcut failed: ${keyboardError.message}`);
                }
            }
            
            if (!splitSuccess) {
                throw new Error('Could not click Split button with any method (selectors or keyboard shortcut)');
            }
            
            // Click on right side to select right image
            await setTimeout(500);
            const rightClickX = canvasBox.x + canvasBox.width - 100;
            const rightClickY = canvasBox.y + canvasBox.trackTop + 25;
            await page.mouse.click(rightClickX, rightClickY);
            console.log('Clicked on right image.');
            
            // Enhanced Delete button logic with multiple fallbacks
            await setTimeout(500);
            let deleteSuccess = false;
            console.log('🗑️ Attempting to click the Delete button with enhanced fallback logic...');
            
            // Multiple Delete button selectors to try
            const deleteButtonSelectors = [
                '#timeline-part-view > div.timeline-tools-wrapper > div.timeline-tools > div.timeline-tools-left > button:nth-child(2)',
                '.timeline-tools-left > button:nth-child(2)',
                '.timeline-tools-left button[title*="Delete"]',
                '.timeline-tools-left button[aria-label*="Delete"]',
                'button[data-testid="delete-button"]',
                '.timeline-tools button:nth-child(2)'
            ];
            
            // Try each selector
            for (let i = 0; i < deleteButtonSelectors.length && !deleteSuccess; i++) {
                try {
                    console.log(`🔍 Trying Delete button selector ${i + 1}/${deleteButtonSelectors.length}: ${deleteButtonSelectors[i]}`);
                    await page.waitForSelector(deleteButtonSelectors[i], { visible: true, timeout: 3000 });
                    await page.click(deleteButtonSelectors[i]);
                    console.log(`✅ Successfully clicked Delete button with selector ${i + 1}`);
                    deleteSuccess = true;
                    break;
                } catch (selectorError) {
                    console.log(`⚠️ Delete button selector ${i + 1} failed: ${selectorError.message}`);
                }
            }
            
            // Keyboard shortcut fallback if all selectors fail
            if (!deleteSuccess) {
                console.log('🎹 All Delete button selectors failed. Trying keyboard shortcut (Delete key)...');
                try {
                    await page.keyboard.press('Delete');
                    await setTimeout(500);
                    console.log('✅ Successfully used keyboard shortcut (Delete) for Delete');
                    deleteSuccess = true;
                } catch (keyboardError) {
                    console.log(`❌ Keyboard shortcut failed: ${keyboardError.message}`);
                }
            }
            
            if (!deleteSuccess) {
                throw new Error('Could not click Delete button with any method (selectors or keyboard shortcut)');
            }
            
            // Zoom in 2 times before clicking on video for better precision
            await setTimeout(500);
            console.log('🔍 Zooming in 2 times before video click for better precision...');
            try {
                // Use CSS selector approach instead of XPath for better compatibility
                const zoomInSelector = '#timeline-part-view .timeline-tools-right button:nth-child(5)';
                
                for (let i = 0; i < 2; i++) {
                    try {
                        await page.waitForSelector(zoomInSelector, { timeout: 3000 });
                        await page.click(zoomInSelector);
                        console.log(`✅ Zoom-in click ${i + 1}/2 before video click`);
                        await setTimeout(300); // Small delay between clicks
                    } catch (selectorError) {
                        console.log(`⚠️ Zoom-in button not found on attempt ${i + 1}, trying alternative...`);
                        
                        // Fallback: try to find zoom button using evaluate
                        const clicked = await page.evaluate(() => {
                            const timelineTools = document.querySelector('#timeline-part-view .timeline-tools-right');
                            if (!timelineTools) return false;
                            
                            const buttons = timelineTools.querySelectorAll('button');
                            const zoomInButton = buttons[4]; // 5th button (0-indexed)
                            if (zoomInButton) {
                                zoomInButton.click();
                                return true;
                            }
                            return false;
                        });
                        
                        if (clicked) {
                            console.log(`✅ Zoom-in click ${i + 1}/2 before video click (fallback method)`);
                        } else {
                            console.log('⚠️ Zoom-in button not found with fallback, continuing anyway...');
                            break;
                        }
                    }
                }
                console.log('✅ Timeline zoomed in 2 times before video click');
                await setTimeout(500); // Wait for zoom to settle
            } catch (error) {
                console.log('⚠️ Could not zoom in before video click, continuing anyway:', error.message);
            }
            
            // Click on video (moved to the left as requested)
            await setTimeout(500);
            const videoClickX = canvasBox.x + 30; // Moved from 50 to 30 (more to the left)
            const videoClickY = canvasBox.y + canvasBox.trackTop - 25;
            console.log(`🎬 Clicking video at position: ${videoClickX}, ${videoClickY}`);
            await page.mouse.click(videoClickX, videoClickY);
            console.log('✅ Clicked on video.');
            
            // Click video cutout button
            await setTimeout(1000);
            const cutoutButtonSelector = '#workbench-tool-bar-toolbarVideoCutout';
            await page.click(cutoutButtonSelector);
            console.log('✅ Clicked video cutout button.');
            
            // Click remove backgrounds option with multiple fallbacks
            await setTimeout(2000); // Increased wait time for UI to load
            console.log('🔍 Looking for remove backgrounds option...');
            
            const cutoutCardSelectors = [
                '#cutout-card',
                '[data-testid="cutout-card"]',
                '.cutout-card',
                'div[id*="cutout"]',
                'button[aria-label*="remove"]',
                'button[aria-label*="background"]',
                'div[role="button"][aria-label*="cutout"]',
                '.remove-background-option',
                '[data-id="cutout-card"]'
            ];
            
            let cutoutCardClicked = false;
            for (const selector of cutoutCardSelectors) {
                try {
                    await page.waitForSelector(selector, { visible: true, timeout: 3000 });
                    await page.click(selector);
                    console.log(`✅ Successfully clicked remove backgrounds with selector: ${selector}`);
                    cutoutCardClicked = true;
                    break;
                } catch (e) {
                    console.log(`⚠️ Cutout card selector failed: ${selector}`);
                }
            }
            
            if (!cutoutCardClicked) {
                // Try to find any element containing "remove" and "background" text
                console.log('🔍 Trying text-based fallback for remove backgrounds...');
                try {
                    const textBasedElement = await page.evaluate(() => {
                        const elements = Array.from(document.querySelectorAll('*'));
                        for (const el of elements) {
                            const text = el.textContent?.toLowerCase() || '';
                            if ((text.includes('remove') && text.includes('background')) || 
                                text.includes('cutout') || 
                                text.includes('remove bg')) {
                                const rect = el.getBoundingClientRect();
                                if (rect.width > 0 && rect.height > 0) {
                                    return {
                                        x: rect.left + rect.width / 2,
                                        y: rect.top + rect.height / 2,
                                        text: text.trim()
                                    };
                                }
                            }
                        }
                        return null;
                    });
                    
                    if (textBasedElement) {
                        await page.mouse.click(textBasedElement.x, textBasedElement.y);
                        console.log(`✅ Clicked remove backgrounds using text fallback: "${textBasedElement.text}"`);
                        cutoutCardClicked = true;
                    }
                } catch (textError) {
                    console.log('⚠️ Text-based fallback failed:', textError.message);
                }
            }
            
            if (cutoutCardClicked) {
                console.log('✅ Remove backgrounds option clicked successfully.');
                broadcastProgress('🎨 Remove backgrounds option selected');
                
                // Click timeline minus button 5 times for better visibility
                console.log('🔍 Clicking timeline minus button 5 times for better visibility...');
                const timelineMinusSelector = '#timeline-part-view > div.timeline-tools-wrapper > div.timeline-tools > div.timeline-tools-right > button:nth-child(4)';
                for (let i = 1; i <= 5; i++) {
                    try {
                        await page.click(timelineMinusSelector);
                        console.log(`✅ Timeline minus button click ${i}/5 successful`);
                        await setTimeout(200); // Small delay between clicks
                    } catch (error) {
                        console.log(`⚠️ Timeline minus button click ${i}/5 failed: ${error.message}`);
                    }
                }
                console.log('🎯 Timeline zoom-out completed (5 clicks)');
                await setTimeout(500); // Wait for timeline to stabilize
            } else {
                console.log('❌ Could not find remove backgrounds option, but continuing...');
                await page.screenshot({ path: path.join(DEBUG_DIR, 'cutout_card_not_found.png') });
            }
            
            // Click cutout switch with a dynamic, robust search
            await setTimeout(1000);
            broadcastProgress('🔍 Dynamically searching for the "Remove Background" switch...');
            const switchButtonHandle = await page.evaluateHandle(() => {
                // Method 1: Find by text label first
                const labels = Array.from(document.querySelectorAll('span, div, p, label'));
                const targetLabel = labels.find(el => {
                    const text = el.innerText.toLowerCase();
                    return (text.includes('auto cutout') || text.includes('remove background') || text.includes('cutout')) && el.offsetHeight > 0;
                });

                if (targetLabel) {
                    // Find the closest common ancestor that likely contains the switch
                    const container = targetLabel.closest('.video-tool-item, .right-panel-item-content-row, .item-container, .tool-item, .panel-item');
                    if (container) {
                        const switchButton = container.querySelector('button[role="switch"]');
                        if (switchButton) {
                            return switchButton;
                        }
                    }
                }

                // Method 2: Direct selector fallbacks
                const directSelectors = [
                    '#cutout-switch',
                    '#cutout-switch button[role="switch"]',
                    '[data-testid="cutout-switch"]',
                    '[data-testid="auto-cutout-switch"]',
                    'button[role="switch"][aria-label*="cutout"]',
                    'button[role="switch"][aria-label*="background"]'
                ];

                for (const selector of directSelectors) {
                    const element = document.querySelector(selector);
                    if (element && element.offsetHeight > 0) {
                        return element;
                    }
                }

                // Method 3: Find any switch and check nearby text
                const allSwitches = Array.from(document.querySelectorAll('button[role="switch"]'));
                for (const switchBtn of allSwitches) {
                    const parent = switchBtn.closest('div');
                    if (parent) {
                        const parentText = parent.innerText.toLowerCase();
                        if (parentText.includes('cutout') || parentText.includes('remove background')) {
                            return switchBtn;
                        }
                    }
                }

                return null;
            });

            const switchElement = switchButtonHandle.asElement();
            if (switchElement) {
                await switchElement.click();
                broadcastProgress('✅ SUCCESS: Dynamically found and clicked the cutout switch.');
            } else {
                broadcastProgress('❌ FAILED: Dynamic search could not find the cutout switch.');
                await page.screenshot({ path: path.join(DEBUG_DIR, 'cutout_switch_dynamic_search_failed.png') });
                throw new Error('Dynamic search failed to find cutout switch.');
            }

            // Wait for background removal completion
            console.log('Checking for background removal success for up to 7 minutes...');
            await page.waitForFunction(() => {
                const switchEl = document.querySelector('button[role="switch"][aria-checked="true"]');
                if (!switchEl) return false; // Not even enabled yet

                const isLoading = switchEl.classList.contains('lv-switch-loading') || switchEl.querySelector('.lv-icon-loading');
                return !isLoading; // Return true when it's checked and not loading
            }, { timeout: 7 * 60 * 1000, polling: 5000 });

            broadcastProgress('✅ Background removal complete.');
            let isRemovalComplete = true;

            if (isRemovalComplete) {
                console.log('Background removal successful. Waiting 7 seconds before exporting...');
                await setTimeout(7000);

                // Export process
                console.log('Proceeding to click the Export button...');
                try {
                    const exportButtonSelector = '#export-video-btn';
                    await page.waitForSelector(exportButtonSelector, { visible: true, timeout: 5000 });
                    await page.click(exportButtonSelector);
                    broadcastProgress('📤 SUCCESS: Export process started!');

                    await setTimeout(10000);
                    
                    // Try to get the video filename from the export dialog input field
                    let videoFileName = null;
                    try {
                        const titleInput = await page.$('#form-video_name_input');
                        if (titleInput) {
                            const titleValue = await titleInput.evaluate(input => input.value);
                            if (titleValue && titleValue.trim()) {
                                videoFileName = titleValue.trim() + '.mp4';
                                broadcastProgress(`📝 Detected video filename: ${videoFileName}`);
                            }
                        }
                    } catch (e) {
                        console.log('Could not get filename from export dialog:', e.message);
                    }
                    
                    const downloadButtonSelector = '.material-export-modal-container .button-x1mG4O';
                    await page.waitForSelector(downloadButtonSelector, { visible: true, timeout: 5000 });
                    await page.click(downloadButtonSelector);
                    console.log('SUCCESS: Clicked the Download button.');

                    await setTimeout(9000);
                    const confirmButtonSelector = '#export-confirm-button';
                    await page.waitForSelector(confirmButtonSelector, { visible: true, timeout: 5000 });
                    await page.click(confirmButtonSelector);
                    console.log('SUCCESS: Clicked the confirmation Export button.');

                    // Wait for download link
                    console.log('Waiting for render... Checking for download link for up to 10 minutes.');
                    const exportTimeout = 10 * 60 * 1000;
                    const exportStartTime = Date.now();
                    let downloadReady = false;

                    while (Date.now() - exportStartTime < exportTimeout) {
                        const downloadLinkSelector = '.downloadBtn-Z6RvjQ a[download]';
                        const downloadLink = await page.$(downloadLinkSelector);

                        if (downloadLink) {
                            // Try multiple methods to get the filename
                            let fileName = await downloadLink.evaluate(a => {
                                // Method 1: Check download attribute
                                let name = a.getAttribute('download');
                                if (name && name.trim()) return name.trim();
                                
                                // Method 2: Extract from href
                                const href = a.href;
                                if (href) {
                                    const urlParts = href.split('/');
                                    name = urlParts[urlParts.length - 1];
                                    if (name && name.includes('.')) return name;
                                }
                                
                                // Method 3: Check text content
                                name = a.textContent.trim();
                                if (name && name.includes('.')) return name;
                                
                                return null;
                            });
                            
                            // Method 4: Use the filename we detected from the export dialog
                            if (!fileName && videoFileName) {
                                fileName = videoFileName;
                                broadcastProgress(`📝 Using detected video filename: ${fileName}`);
                            }
                            
                            // If we still don't have a filename, use a timestamp-based approach
                            if (!fileName) {
                                broadcastProgress('⏳ WAITING FOR VIDEONAME IN CAPCUT TO DOWNLOAD');
                                
                                // Get list of files before download
                                const filesBefore = fs.existsSync(DOWNLOADS_DIR) ? fs.readdirSync(DOWNLOADS_DIR) : [];
                                
                                // Wait a bit for download to start
                                await setTimeout(3000);
                                
                                // Monitor for new files
                                const downloadWaitTimeout = 15 * 60 * 1000; // 15 minutes
                                const downloadWaitStart = Date.now();
                                let foundNewFile = false;
                                
                                broadcastProgress(`🔍 Starting 15-minute monitoring for new video files...`);
                                
                                while(Date.now() - downloadWaitStart < downloadWaitTimeout && !foundNewFile) {
                                    if (fs.existsSync(DOWNLOADS_DIR)) {
                                        const filesAfter = fs.readdirSync(DOWNLOADS_DIR);
                                        const newFiles = filesAfter.filter(file => !filesBefore.includes(file));
                                        
                                        for (const newFile of newFiles) {
                                            const filePath = path.join(DOWNLOADS_DIR, newFile);
                                            const stats = fs.statSync(filePath);
                                            
                                            // Check if it's a video file and has some size
                                            if (stats.size > 1000 && (newFile.endsWith('.mp4') || newFile.endsWith('.mov') || newFile.endsWith('.avi'))) {
                                                // Wait for file to stabilize (download complete)
                                                let lastSize = -1;
                                                let stableCount = 0;
                                                
                                                while (stableCount < 3) { // Wait for 3 consecutive stable checks
                                                    await setTimeout(2000);
                                                    const currentStats = fs.statSync(filePath);
                                                    if (currentStats.size === lastSize && currentStats.size > 0) {
                                                        stableCount++;
                                                    } else {
                                                        stableCount = 0;
                                                    }
                                                    lastSize = currentStats.size;
                                                }
                                                
                                                broadcastProgress(`DOWNLOADED: ${filePath}`);
                                                downloadReady = true;
                                                foundNewFile = true;
                                                break;
                                            }
                                        }
                                    }
                                    
                                    if (!foundNewFile) {
                                        const elapsed = Math.round((Date.now() - downloadWaitStart) / 1000);
                                        broadcastProgress(`🔍 Still monitoring... (${elapsed}s elapsed, max 15min)`);
                                        await setTimeout(5000); // Check every 5 seconds
                                    }
                                }
                                
                                if (!foundNewFile) {
                                    throw new Error('No new video file detected in downloads folder after 15 minutes.');
                                }
                                
                            } else {
                                // We have a filename, use robust matching method
                                broadcastProgress(`🔗 Download ready for: ${fileName}`);
                                
                                // Create a normalized version of the expected filename for comparison
                                function normalizeFilename(filename) {
                                    return filename
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
                                }
                                
                                const normalizedExpected = normalizeFilename(fileName.replace(/\.[^.]+$/, '')); // Remove extension
                                broadcastProgress(`🔍 Looking for files matching: ${normalizedExpected}`);
                                
                                // Wait for a matching file to appear and be fully written
                                let matchedFile = null;
                                const downloadWaitTimeout = 15 * 60 * 1000; // 15 minutes
                                const downloadWaitStart = Date.now();
                                let lastSize = -1;
                                
                                while(Date.now() - downloadWaitStart < downloadWaitTimeout) {
                                    if (fs.existsSync(DOWNLOADS_DIR)) {
                                        const files = fs.readdirSync(DOWNLOADS_DIR);
                                        
                                        // Look for files that match when normalized
                                        for (const file of files) {
                                            if (file.endsWith('.mp4') || file.endsWith('.mov') || file.endsWith('.avi')) {
                                                const normalizedFile = normalizeFilename(file.replace(/\.[^.]+$/, ''));
                                                
                                                // Check if files match (allow partial match for truncated names)
                                                const isMatch = normalizedFile.includes(normalizedExpected.substring(0, 30)) || 
                                                              normalizedExpected.includes(normalizedFile.substring(0, 30)) ||
                                                              normalizedFile === normalizedExpected;
                                                
                                                if (isMatch) {
                                                    const filePath = path.join(DOWNLOADS_DIR, file);
                                                    const stats = fs.statSync(filePath);
                                                    
                                                    if (stats.size > 1000) { // File has some content
                                                        if (stats.size === lastSize && lastSize > 0) {
                                                            // File exists and size hasn't changed, assume download is complete
                                                            matchedFile = filePath;
                                                            broadcastProgress(`✅ Found matching file: ${file}`);
                                                            break;
                                                        }
                                                        lastSize = stats.size;
                                                        broadcastProgress(`📥 Downloading ${file}... ${Math.round(stats.size / 1024 / 1024)}MB`);
                                                    }
                                                }
                                            }
                                        }
                                        
                                        if (matchedFile) break;
                                    }
                                    
                                    await setTimeout(2000); // Check every 2 seconds
                                }

                                if (matchedFile) {
                                    broadcastProgress(`DOWNLOADED: ${matchedFile}`);
                                    downloadReady = true;
                                } else {
                                    broadcastProgress(`❌ No matching file found for: ${fileName}`);
                                    throw new Error(`Download timed out. No matching video file found for: ${fileName}`);
                                }
                            }
                            
                            break; // Exit the while loop since we found the download link
                        }
                        
                        broadcastProgress(`⏳ Rendering video... (${Math.round((Date.now() - exportStartTime) / 1000)}s elapsed)`);
                        await setTimeout(15000);
                    }

                    if (!downloadReady) {
                        broadcastProgress('❌ FAILED: Download link did not appear within 10 minutes.');
                        throw new Error('Download link did not appear within the timeout.');
                    }

                } catch (e) {
                    broadcastProgress(`❌ FAILED: An error occurred during the export/download process: ${e.message}`);
                    throw e; // Re-throw to stop the script
                }
            } else {
                broadcastProgress('❌ FAILED: Background removal did not complete within the 7-minute timeout.');
                throw new Error('Background removal timed out.');
            }
        } catch (e) {
            broadcastProgress(`❌ FAILED: Could not click the Split button: ${e.message}`);
            throw e; // Re-throw to stop the script
        }

        broadcastProgress('🏆 Full automation pipeline completed successfully!');
        
        // Close the editor tab and update status
        await closeEditorTab(browser, page);
        
        broadcastProgress('🔍 Browser ready for next automation.');
        
    } catch (error) {
        // Only show detailed error logs for non-availability issues
        if (!error.message.includes('No editors available')) {
            console.error('❌ Pipeline error:', error.message);
            
            // Take screenshot for debugging
            const errorScreenshotPath = path.join(DEBUG_DIR, 'pipeline_error_screenshot.png');
            if(browser) {
                const pages = await browser.pages();
                if (pages.length > 0) {
                     await pages[0].screenshot({ path: errorScreenshotPath, fullPage: true });
                     console.log(`📷 Error screenshot saved to ${errorScreenshotPath}`);
                }
            }
            
            // Close the editor tab even on error to free it up
            if (browser) {
                try {
                    const pages = await browser.pages();
                    if (pages.length > 1) { // Don't close if it's the only page
                        const currentPage = pages.find(p => p.url().includes('capcut.com'));
                        if (currentPage) {
                            await closeEditorTab(browser, currentPage);
                        }
                    }
                } catch (tabError) {
                    console.log('⚠️ Could not close editor tab:', tabError.message);
                }
            }
            
            console.log('🔍 Pipeline finished with error. Browser remains open for inspection.');
        }
        
        throw error;
    }
}

async function testTimeline() {
    let browser = null;
    try {
        console.log('Launching browser...');
        browser = await puppeteer.launch({
            executablePath: BROWSER_EXECUTABLE_PATH,
            userDataDir: USER_DATA_DIR,
            headless: false,
            args: ['--start-maximized', '--disable-blink-features=AutomationControlled']
        });

        const page = await browser.newPage();

        // Set download behavior for the entire browser context
        const client = await browser.target().createCDPSession();
        await client.send('Browser.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: DOWNLOADS_DIR,
            eventsEnabled: true
        });

        await page.setViewport({ width: 1280, height: 720 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        const targetUrl = 'https://www.capcut.com/editor/7112E169-D6E2-40C9-87AE-6845F2E22F9A?scenario=custom&workspaceId=7238565158438666266&spaceId=7201822129011032347';

        console.log('Navigating to CapCut editor...');
        await page.goto('https://www.google.com', { waitUntil: 'networkidle2' });
        await page.evaluate(url => { window.location.href = url; }, targetUrl);
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });

        console.log('Page loaded. Moving playhead to start and scanning for resize handle...');
        
        // Move playhead to start (00:00:00)
        await TimelineUtils.movePlayhead(page, 0);
        await setTimeout(1000); // Wait for any UI updates

        console.log('AI is zooming out the timeline 5 times using the correct selector...');
        try {
            const zoomOutButtonSelector = '#timeline-part-view > div.timeline-tools-wrapper > div.timeline-tools > div.timeline-tools-right > button:nth-child(4)';
            await page.waitForSelector(zoomOutButtonSelector, { timeout: 10000 });
            console.log('Zoom-out button found. Clicking 5 times...');
            for (let i = 0; i < 5; i++) {
                await page.click(zoomOutButtonSelector);
                await setTimeout(250); // Wait for UI to update
            }
            console.log('Timeline zoomed out successfully.');
        } catch (e) {
            console.error('Could not find or click the zoom-out button with the new selector.', e.message);
        }

        // Find the timeline canvas and get its bounding box
        const canvasSelector = 'div.konvajs-content canvas';
        // --- Set fixed duration to 30 seconds ---
        const targetDuration = 30; // 30 seconds
        console.log(`Setting fixed duration to: ${targetDuration} seconds`);
        
        const canvasBox = await page.evaluate(selector => {
            const canvas = document.querySelector(selector);
            if (!canvas) return null;
            const rect = canvas.getBoundingClientRect();
            const timelineEl = document.getElementById('timeline');
            const trackTopStyle = getComputedStyle(timelineEl).getPropertyValue('--main-track-top');
            const trackTop = parseInt(trackTopStyle, 10) || 87; // Default to 87 if not found
            return { 
                x: rect.x, 
                y: rect.y, 
                width: rect.width, 
                height: rect.height,
                trackTop: trackTop
            };
        }, canvasSelector);

        if (!canvasBox) {
            throw new Error('Could not find timeline canvas.');
        }

        console.log('Canvas found at:', canvasBox);

        // Add a delay to give user time to select the clip
        console.log('Waiting 5 seconds for you to select the clip...');
        await setTimeout(5000);

        // Get the total video duration and click at the last second
        const videoDuration = await page.evaluate(() => {
            const timeDisplay = document.querySelector('.player-time');
            if (timeDisplay) {
                const timeStr = timeDisplay.textContent.trim().split(' / ')[1]; // Get the total duration part
                if (timeStr) {
                    const [h, m, s] = timeStr.split(':').map(Number);
                    return (h * 3600) + (m * 60) + s; // Convert to seconds
                }
            }
            return 30; // Default to 30 seconds if can't detect
        });
        
        console.log(`Video duration: ${videoDuration} seconds`);
        
        // Click at the last second of the video
        const clickPosition = await page.evaluate((duration) => {
            const timeline = document.querySelector('#timeline-part-view');
            if (!timeline) return null;
            
            const rect = timeline.getBoundingClientRect();
            const totalWidth = rect.width;
            
            // Calculate position for the last second (99% of the timeline)
            const position = (duration > 0 ? (duration - 1) / duration : 0.99) * totalWidth;
            const clickX = rect.left + position;
            const clickY = rect.top + (rect.height / 2);
            
            return { x: clickX, y: clickY };
        }, videoDuration);
        
        if (clickPosition) {
            console.log(`Clicking at position: ${clickPosition.x}, ${clickPosition.y}`);
            await page.mouse.click(clickPosition.x, clickPosition.y);
            await setTimeout(500);
        }
        console.log('Continuing...');

        // --- Enhanced Resize Handle Detection ---
        console.log('🔍 Starting enhanced resize handle detection...');
        
        // Take screenshot before scanning
        await page.screenshot({ path: path.join(DEBUG_DIR, 'before_resize_scan.png') });
        
        // First, try to find any selected clips
        const selectedClips = await page.evaluate(() => {
            const clips = document.querySelectorAll('[data-testid="timeline-clip"], .timeline-clip, .clip-item');
            const selected = [];
            clips.forEach((clip, index) => {
                const rect = clip.getBoundingClientRect();
                const isSelected = clip.classList.contains('selected') || 
                                 clip.getAttribute('aria-selected') === 'true' ||
                                 getComputedStyle(clip).border.includes('rgb');
                selected.push({
                    index,
                    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                    isSelected,
                    className: clip.className
                });
            });
            return selected;
        });
        
        console.log('🎥 Found clips:', selectedClips.length);
        selectedClips.forEach((clip, i) => {
            console.log(`  Clip ${i}: Selected=${clip.isSelected}, Pos=(${Math.round(clip.rect.x)}, ${Math.round(clip.rect.y)}), Size=${Math.round(clip.rect.width)}x${Math.round(clip.rect.height)}`);
        });

        const centerVerticalPosition = canvasBox.y + canvasBox.trackTop + 25;
        const verticalScanRadius = 25; // Increased scan radius

        let resizeHandleX = -1;
        let resizeHandleY = -1;
        const startScanX = Math.round(canvasBox.x + 100); // Start further in
        const endScanX = Math.round(canvasBox.x + canvasBox.width - 100);

        console.log(`🔍 Scanning area: X from ${startScanX} to ${endScanX}, Y from ${centerVerticalPosition - verticalScanRadius} to ${centerVerticalPosition + verticalScanRadius}`);

        // Enhanced scanning with multiple cursor types and better detection
        scanLoop: for (let x = startScanX; x < endScanX; x += 3) { // Smaller steps for better detection
            for (let y = centerVerticalPosition - verticalScanRadius; y <= centerVerticalPosition + verticalScanRadius; y += 3) {
                await page.mouse.move(x, y, { steps: 1 });
                await setTimeout(5); // Faster scanning
                
                // Check multiple cursor types and element states
                const cursorInfo = await page.evaluate((canvasSel, mouseX, mouseY) => {
                    const canvas = document.querySelector(canvasSel);
                    const cursor = canvas ? getComputedStyle(canvas).cursor : 'default';
                    
                    // Also check if we're over any resize-related elements
                    const elementAtPoint = document.elementFromPoint(mouseX, mouseY);
                    const elementCursor = elementAtPoint ? getComputedStyle(elementAtPoint).cursor : 'default';
                    
                    return {
                        canvasCursor: cursor,
                        elementCursor: elementCursor,
                        elementTag: elementAtPoint ? elementAtPoint.tagName : 'none',
                        elementClass: elementAtPoint ? elementAtPoint.className : 'none'
                    };
                }, canvasSelector, x, y);

                // Check for resize cursors
                if (cursorInfo.canvasCursor.includes('col-resize') || 
                    cursorInfo.elementCursor.includes('col-resize') ||
                    cursorInfo.canvasCursor.includes('ew-resize') ||
                    cursorInfo.elementCursor.includes('ew-resize')) {
                    
                    console.log(`✅ Resize handle area found at X=${x}, Y=${y}`);
                    console.log(`   Canvas cursor: ${cursorInfo.canvasCursor}`);
                    console.log(`   Element cursor: ${cursorInfo.elementCursor}`);
                    console.log(`   Element: ${cursorInfo.elementTag}.${cursorInfo.elementClass}`);
                    
                    resizeHandleY = y;

                    // Fine-tune the exact edge position
                    let currentX = x;
                    let bestX = x;
                    const maxScanRight = Math.min(x + 50, endScanX);
                    
                    while(currentX < maxScanRight) {
                        await page.mouse.move(currentX, resizeHandleY, { steps: 1 });
                        await setTimeout(3);
                        
                        const checkCursor = await page.evaluate((canvasSel) => {
                            const canvas = document.querySelector(canvasSel);
                            return canvas ? getComputedStyle(canvas).cursor : 'default';
                        }, canvasSelector);
                        
                        if (checkCursor.includes('col-resize') || checkCursor.includes('ew-resize')) {
                            bestX = currentX;
                        } else {
                            break; // Found the edge
                        }
                        currentX++;
                    }

                    resizeHandleX = bestX;
                    console.log(`🎯 Exact resize handle position: X=${resizeHandleX}, Y=${resizeHandleY}`);
                    await page.screenshot({ path: path.join(DEBUG_DIR, 'resize_handle_found.png') });
                    break scanLoop;
                }
            }
            
            // Progress indicator every 100 pixels
            if (x % 100 === 0) {
                console.log(`   Scanning progress: ${Math.round((x - startScanX) / (endScanX - startScanX) * 100)}%`);
            }
        }

        if (resizeHandleX === -1) {
            console.error('❌ ERROR: Could not find resize handle!');
            console.log('📝 Troubleshooting tips:');
            console.log('   1. Make sure a clip is selected (click on it)');
            console.log('   2. Try zooming out more on the timeline');
            console.log('   3. Check if the clip is visible in the timeline');
            
            await page.screenshot({ path: path.join(DEBUG_DIR, 'resize_handle_not_found.png') });
            broadcastProgress('❌ Could not find resize handle. Make sure clip is selected.');
            throw new Error('Resize handle not found. Please select a clip and try again.');
        }

        // --- Calculate Drag Distance & Perform Drag ---
        const PIXELS_PER_SECOND = 30; // 30 pixels = 1 second
        const currentImageWidthInPixels = resizeHandleX - canvasBox.x;
        const targetWidthInPixels = targetDuration * PIXELS_PER_SECOND;
        const dragDistance = Math.round(targetWidthInPixels - currentImageWidthInPixels);

        if (dragDistance <= 0) {
            console.log('Image duration is already sufficient. No drag needed.');
        } else {
            console.log(`Current image width: ${currentImageWidthInPixels}px`);
            console.log(`Target width for ${videoDuration} seconds: ${targetWidthInPixels}px`);
            console.log(`Dragging ${dragDistance}px to extend the clip`);

            const targetX = resizeHandleX + dragDistance;
            await page.mouse.move(resizeHandleX, resizeHandleY);
            await setTimeout(100);
            await page.mouse.down();
            await setTimeout(100);
            await page.mouse.move(targetX, resizeHandleY, { steps: 20 });
            await setTimeout(100);
            await page.mouse.up();

            console.log('Drag complete. Clip duration should be adjusted.');
        }

        console.log('Drag complete. Clip duration should be adjusted.');
        await page.screenshot({ path: path.join(DEBUG_DIR, 'after_drag.png') });

        // --- Image resize complete - Split already handled by runAutomationPipeline ---
        console.log('✅ Image resize complete. Split operation handled by main pipeline.');
        broadcastProgress('✅ Resize complete. Continuing with automation...');
        
        // The split operation is already handled by runAutomationPipeline function
        // No need to duplicate it here - just continue with verification
        
        try {
            // Wait a moment for any UI updates from the split operation
            await setTimeout(2000);
            
            // Verify that background removal is accessible
            console.log('🔍 Verifying automation pipeline completion...');
            
            // Check if video cutout button is available (indicates split was successful)
            const cutoutButtonSelector = '#workbench-tool-bar-toolbarVideoCutout';
            const cutoutButton = await page.$(cutoutButtonSelector);
            
            if (cutoutButton) {
                console.log('✅ Video cutout button found - split operation was successful!');
                broadcastProgress('✅ Split operation completed successfully!');
            } else {
                console.log('⚠️ Video cutout button not found - split may have failed');
                broadcastProgress('⚠️ Warning: Split verification inconclusive');
            }
            
            // Click remove backgrounds option
            await setTimeout(1000);
            const removeBackgroundSelector = '#cutout-card';
            await page.click(removeBackgroundSelector);
            console.log('Clicked remove backgrounds option.');
            
            // Click timeline minus button 5 times for better visibility
            console.log('🔍 Clicking timeline minus button 5 times for better visibility...');
            const timelineMinusSelector = '#timeline-part-view > div.timeline-tools-wrapper > div.timeline-tools > div.timeline-tools-right > button:nth-child(4)';
            for (let i = 1; i <= 5; i++) {
                try {
                    await page.click(timelineMinusSelector);
                    console.log(`✅ Timeline minus button click ${i}/5 successful`);
                    await setTimeout(200); // Small delay between clicks
                } catch (error) {
                    console.log(`⚠️ Timeline minus button click ${i}/5 failed: ${error.message}`);
                }
            }
            console.log('🎯 Timeline zoom-out completed (5 clicks)');
            await setTimeout(500); // Wait for timeline to stabilize
            
            // Click cutout switch
            await setTimeout(1000);
            const cutoutSwitchSelector = '#cutout-switch';
            await page.click(cutoutSwitchSelector);
            console.log('Clicked cutout switch.');
            
            // Check for background removal success for up to 7 minutes, with detailed logging
            console.log('Checking for background removal success for up to 7 minutes...');
            const startTime = Date.now();
            const timeout = 7 * 60 * 1000; // 7 minutes in milliseconds
            let isRemovalComplete = false;

            while (Date.now() - startTime < timeout) {
                const switchSelector = '#cutout-switch button[role="switch"]';
                const switchElement = await page.$(switchSelector);

                if (switchElement) {
                    const isChecked = await switchElement.evaluate(el => el.getAttribute('aria-checked') === 'true');
                    const hasCheckedClass = await switchElement.evaluate(el => el.classList.contains('lv-switch-checked'));

                    if (isChecked && hasCheckedClass) {
                        // Get detailed info for the log, as requested
                        const classList = await switchElement.evaluate(el => Array.from(el.classList));
                        const outerHTML = await switchElement.evaluate(el => el.outerHTML);

                        console.log('Switch found:');
                        console.log('- aria-checked:', isChecked);
                        console.log('- CSS classes:', classList);
                        console.log('- Full HTML:', outerHTML);
                        console.log('SUCCESS: Background removal completed!');

                        isRemovalComplete = true;
                        break; // Exit the loop on success
                    }
                }
                
                // Wait for 15 seconds before checking again
                console.log(`Still waiting for background removal... (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);
                await setTimeout(15000);
            }

            if (isRemovalComplete) {
                // Wait 7 seconds for UI to stabilize after background removal
                console.log('Background removal successful. Waiting 7 seconds before exporting...');
                await setTimeout(7000);

                // Step: Click the main Export button
                console.log('Proceeding to click the Export button...');
                try {
                    const exportButtonSelector = '#export-video-btn';
                    await page.waitForSelector(exportButtonSelector, { visible: true, timeout: 5000 });
                    await page.click(exportButtonSelector);
                    console.log('SUCCESS: Clicked the main Export button. Rendering should now begin.');

                    // Wait 10 seconds, then click Download
                    console.log('Waiting 10 seconds before clicking Download...');
                    await setTimeout(10000);

                    const downloadButtonSelector = '.material-export-modal-container .button-x1mG4O';
                    await page.waitForSelector(downloadButtonSelector, { visible: true, timeout: 5000 });
                    await page.click(downloadButtonSelector);
                    console.log('SUCCESS: Clicked the Download button.');

                    // Wait 9 seconds, then click confirmation export
                    console.log('Waiting 9 seconds, then clicking confirmation export button...');
                    await setTimeout(9000);

                    const confirmButtonSelector = '#export-confirm-button';
                    await page.waitForSelector(confirmButtonSelector, { visible: true, timeout: 5000 });
                    await page.click(confirmButtonSelector);
                    console.log('SUCCESS: Clicked the confirmation Export button.');

                    // FINAL STEP: Wait for the download link and the actual file download
                    broadcastProgress('✅ Export confirmed. Waiting for download link...');
                    const exportTimeout = 10 * 60 * 1000; // 10 minutes
                    const exportStartTime = Date.now();
                    let downloadReady = false;

                    while (Date.now() - exportStartTime < exportTimeout) {
                        const downloadLinkSelector = '.downloadBtn-Z6RvjQ a[download]';
                        const downloadLink = await page.$(downloadLinkSelector);

                        if (downloadLink) {
                            const fileName = await downloadLink.evaluate(a => a.getAttribute('download'));
                            broadcastProgress(`🔗 Download link found for: ${fileName}`);
                            const expectedFilePath = path.join(DOWNLOADS_DIR, fileName);
                            
                            broadcastProgress(`⏳ Waiting for video to be saved to: ${DOWNLOADS_DIR}`);
                            
                            // Wait for the file to appear and be fully written by checking for a stable file size
                            let fileExists = false;
                            const downloadWaitTimeout = 5 * 60 * 1000; // 5 minutes
                            const downloadWaitStart = Date.now();
                            let lastSize = -1;
                            
                            while(Date.now() - downloadWaitStart < downloadWaitTimeout) {
                                if (fs.existsSync(expectedFilePath)) {
                                    const stats = fs.statSync(expectedFilePath);
                                    if (stats.size > 0 && stats.size === lastSize) {
                                        // File exists and size hasn't changed for 2 seconds, assume download is complete
                                        fileExists = true;
                                        break;
                                    }
                                    lastSize = stats.size;
                                }
                                await setTimeout(2000); // Check every 2 seconds
                            }

                            if (fileExists) {
                                broadcastProgress(`🏆 DOWNLOAD COMPLETE: Video saved to ${expectedFilePath}`);
                                downloadReady = true;
                                break;
                            } else {
                                throw new Error(`Download timed out. File was not found at ${expectedFilePath} after 5 minutes.`);
                            }
                        }
                        
                        broadcastProgress(`⏳ Rendering video... (${Math.round((Date.now() - exportStartTime) / 1000)}s elapsed)`);
                        await setTimeout(15000); // Wait 15 seconds before next check
                    }

                    if (!downloadReady) {
                        broadcastProgress('❌ FAILED: Download link did not appear within 10 minutes.');
                        throw new Error('Download link did not appear within the timeout.');
                    }
                    console.log('Automation complete.');

                } catch (e) {
                    broadcastProgress(`❌ FAILED: An error occurred during the export/download process: ${e.message}`);
                    throw e; // Re-throw to stop the script
                }
            } else {
                broadcastProgress('❌ FAILED: Background removal did not complete within the 7-minute timeout.');
                throw new Error('Background removal timed out.'); // Stop the script
            }
        } catch (e) {
            broadcastProgress(`❌ FAILED: Could not click the Split button: ${e.message}`);
            await page.screenshot({ path: path.join(DEBUG_DIR, 'split_button_error.png') });
            throw e; // Re-throw to stop the script
        }
        
        broadcastProgress('✅ Verification complete. The browser will remain open for inspection.');
        
        // Reset editor status to available on success
        if (editorUrl) {
            await updateEditorStatus(editorUrl, 'available');
        }
        
        return true; // Explicitly return true on success

    } catch (error) {
        // Only log detailed errors for non-availability issues
        if (!error.message.includes('No editors available')) {
            console.error('❌ Pipeline error:', error.message);
            broadcastProgress('❌ Pipeline finished with error. Browser remains open for inspection.');
            
            // Automatic status handling based on error type
            if (filePath) {
                const fileName = path.basename(filePath, path.extname(filePath));
                
                // If error occurs after background removal (export/download phase), set status to "filed"
                if (error.message.includes('export-confirm-button') || 
                    error.message.includes('export') || 
                    error.message.includes('download') ||
                    error.message.includes('Export') ||
                    error.message.includes('Download')) {
                    
                    console.log('🔄 Automation failed during export/download phase - updating status to "filed"');
                    try {
                        await updateVideoStatusInJson(fileName, 'filed');
                        console.log('✅ Video status automatically updated to "filed"');
                        broadcastProgress('📝 Video status updated to "filed" (background removal completed, export failed)');
                    } catch (statusError) {
                        console.log('⚠️ Failed to update video status:', statusError.message);
                    }
                } else {
                    // For other errors (timeline, split, etc.), keep status as "downloaded"
                    console.log('🔄 Automation failed during early phase - keeping status as "downloaded"');
                }
            }
            
            // Take screenshot for debugging non-availability errors
            const errorScreenshotPath = path.join(DEBUG_DIR, 'pipeline_error_screenshot.png');
            if(browser) {
                const pages = await browser.pages();
                if (pages.length > 0) {
                     await pages[1].screenshot({ path: errorScreenshotPath, fullPage: true });
                     console.log(`📷 Error screenshot saved to ${errorScreenshotPath}`);
                }
            }
        }
        
        // Reset editor status to available on error
        if (editorUrl) {
            await updateEditorStatus(editorUrl, 'available');
        }
        
        throw error; // Re-throw the error
    }
}

// Export the functions for use by other modules
module.exports = { 
    runAutomationPipeline,
    uploadVideo,
    moveToTrack2,
    testTimeline
};

// If this file is run directly, execute the test function
if (require.main === module) {
    testTimeline();
}
