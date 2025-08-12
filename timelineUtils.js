const path = require('path');
const fs = require('fs');
const { setTimeout } = require('timers/promises');

class TimelineUtils {
    /**
     * Move the playhead to a specific time in the timeline
     * @param {Page} page - Puppeteer page object
     * @param {string|number} targetTime - Time to move to (in seconds or 'HH:MM:SS' format)
     * @param {Object} options - Additional options
     * @param {boolean} options.relative - If true, treats targetTime as relative to current time
     * @returns {Promise<void>}
     */
    static async movePlayhead(page, targetTime, options = {}) {
        console.log(`Moving playhead to ${options.relative ? 'relative time' : 'time'}: ${targetTime}`);
        
        // If targetTime is a number, treat it as seconds
        if (typeof targetTime === 'number') {
            targetTime = this.secondsToHMS(targetTime);
        }

        try {
            await page.evaluate(async (time, isRelative) => {
                const timeDisplay = document.querySelector('#timeline-part-view > div.timeline-tools-wrapper > div.timeline-tools > div.timeline-tools-center > div.player-time');
                if (!timeDisplay) {
                    console.error('Time display element not found');
                    return false;
                }

                // Click the time display to focus it if needed
                timeDisplay.click();
                
                // Set the time value
                const input = timeDisplay.querySelector('input') || timeDisplay;
                input.value = time;
                
                // Trigger input and change events
                const event = new Event('input', { bubbles: true });
                input.dispatchEvent(event);
                
                const changeEvent = new Event('change', { bubbles: true });
                input.dispatchEvent(changeEvent);
                
                // Press Enter to confirm
                const keyEvent = new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    bubbles: true,
                    cancelable: true
                });
                input.dispatchEvent(keyEvent);
                
                return true;
            }, targetTime, options.relative);
            
            // Wait for the timeline to update
            await setTimeout(500);
            console.log(`Playhead moved to ${targetTime}`);
            
        } catch (error) {
            console.error('Error moving playhead, falling back to click:', error.message);
            // Fallback to clicking on the timeline if direct time input fails
            await this.clickTimelineAtTime(page, targetTime, options);
        }
    }
    
    /**
     * Alternative method to click on the timeline at a specific time position
     * @private
     */
    static async clickTimelineAtTime(page, targetTime, options = {}) {
        console.log('Attempting to click on timeline at position...');
        
        try {
            // Convert targetTime to seconds if it's in HH:MM:SS format
            const targetSeconds = typeof targetTime === 'string' ? this.hmsToSeconds(targetTime) : targetTime;

            // Step 1: Get the total duration string from the browser
            const durationStr = await page.evaluate(() => {
                const timeDisplay = document.querySelector('.player-time');
                return timeDisplay ? timeDisplay.textContent.trim().split(' / ')[1] : '00:00:30';
            });

            // Step 2: Convert duration string to seconds in Node.js
            const totalDuration = this.hmsToSeconds(durationStr || '00:00:30');

            // Step 3: Perform the click in the browser with all necessary data
            await page.evaluate(async ({ timeInSeconds, totalDurationInSeconds }) => {
                const timeline = document.querySelector('#timeline-part-view');
                if (!timeline) {
                    console.error('Timeline element not found');
                    return;
                }
                
                const rect = timeline.getBoundingClientRect();
                const totalWidth = rect.width;
                
                // Calculate position to click (in pixels from left)
                const position = Math.min((timeInSeconds / totalDurationInSeconds) * totalWidth, totalWidth - 10);
                const clickX = rect.left + 10 + position; // 10px padding from left
                const clickY = rect.top + (rect.height / 2); // Vertical center
                
                // Simulate mouse events using Puppeteer's API for reliability
                // Note: This part is illustrative; actual clicks are done via page.mouse.click
                // The evaluation here is just to calculate coordinates.
                // We will return the coordinates and click with puppeteer.
                return { clickX, clickY };

            }, { timeInSeconds: targetSeconds, totalDurationInSeconds: totalDuration });

            // This part is simplified as the logic above is complex to implement with page.evaluate for clicks
            // A direct click is more reliable.
            const timelineRect = await page.evaluate(() => {
                const timeline = document.querySelector('#timeline-part-view');
                if (!timeline) return null;
                const rect = timeline.getBoundingClientRect();
                return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
            });

            if(timelineRect) {
                const position = Math.min((targetSeconds / totalDuration) * timelineRect.width, timelineRect.width - 10);
                const clickX = timelineRect.left + 10 + position;
                const clickY = timelineRect.top + (timelineRect.height / 2);
                await page.mouse.click(clickX, clickY);
            }

            await setTimeout(500);
            console.log(`Clicked on timeline at position for time: ${targetTime}`);
        } catch (e) {
            console.error('Failed to click on timeline:', e.message);
        }
    }
    
    /**
     * Convert seconds to HH:MM:SS format
     * @param {number} seconds - Time in seconds
     * @returns {string} Formatted time string
     */
    static secondsToHMS(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return [
            h.toString().padStart(2, '0'),
            m.toString().padStart(2, '0'),
            s.toString().padStart(2, '0')
        ].join(':');
    }
    
    /**
     * Convert HH:MM:SS format to seconds
     * @param {string} hms - Time in HH:MM:SS format
     * @returns {number} Time in seconds
     */
    static hmsToSeconds(hms) {
        const [h, m, s] = hms.split(':').map(Number);
        return (h * 3600) + (m * 60) + s;
    }
}

module.exports = TimelineUtils;
