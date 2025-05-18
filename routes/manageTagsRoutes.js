import express from 'express';
import { protect as protectRoute } from './auth.js';
import mongoose from 'mongoose'; // Needed for ObjectId
// import { Parser } from 'json2csv'; // For CSV export

// This function accepts the db instance (Mongoose connection) as an argument
export default function createManageTagsRoutes(db) {
    const router = express.Router();

    // Protect all routes in this router
    router.use(protectRoute);

    // Get the AssetTags collection
    const AssetTags = db.collection('asset_tags');

    // @route   GET /api/manage/tags
    // @desc    Get all asset tags for the logged-in user, optionally filtered
    // @access  Private
    router.get('/', async (req, res) => {
        try {
            console.log('[Manage Tags Route] req.user.id:', req.user.id, 'Type:', typeof req.user.id);
            const query = { userId: req.user.id }; // Only fetch tags for the logged-in user

            // --- TEMPORARY DEBUGGING --- 
            // const tags = await AssetTags.find({}).sort({ scannedAt: -1 }).toArray(); // Fetch all to test rendering
            // console.log('[Manage Tags Route] Temporarily fetched all tags:', tags.length);
            // --- END TEMPORARY DEBUGGING ---
            
            const tags = await AssetTags.find(query).sort({ scannedAt: -1 }).toArray();
            console.log(`[Manage Tags Route] Found ${tags.length} tags for userId: ${req.user.id}`);
            res.json(tags);
        } catch (err) {
            console.error('Error fetching asset tags:', err);
            res.status(500).send('Server error');
        }
    });

    // @route   GET /api/manage/tags/all
    // @desc    Get asset tags for all users (admin function)
    // @access  Private
    router.get('/all', async (req, res) => {
        try {
            console.log('[Manage Tags Route] Fetching tags for all users by:', req.user.email);
            
            // No userId filter - returns all tags
            const tags = await AssetTags.find({}).sort({ scannedAt: -1 }).toArray();
            console.log(`[Manage Tags Route] Found ${tags.length} total tags across all users`);
            res.json(tags);
        } catch (err) {
            console.error('Error fetching all asset tags:', err);
            res.status(500).send('Server error');
        }
    });

    // @route   DELETE /manage/tags
    // @desc    Delete one or more asset tags
    // @access  Private
    router.delete('/', async (req, res) => {
        const { ids } = req.body; // Expect an array of string IDs

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ message: 'Please provide tag IDs to delete.' });
        }

        try {
            const objectIds = ids.map(id => new mongoose.Types.ObjectId(id));
            
            // Ensure users can only delete their own tags
            const deleteResult = await AssetTags.deleteMany({ 
                _id: { $in: objectIds },
                userId: req.user.id 
            });

            if (deleteResult.deletedCount === 0) {
                return res.status(404).json({ message: 'No tags found to delete, or you do not own these tags.' });
            }

            res.json({ message: `${deleteResult.deletedCount} tag(s) deleted successfully.` });
        } catch (err) {
            console.error('Error deleting asset tags:', err);
            // Check for CastError specifically for invalid ObjectId format
            if (err.name === 'BSONTypeError' || err.name === 'CastError') {
                 return res.status(400).json({ message: 'Invalid ID format provided.' });
            }
            res.status(500).send('Server error');
        }
    });

    // @route   GET /manage/tags/export
    // @desc    Export asset tags as CSV
    // @access  Private
    router.get('/export', async (req, res) => {
        const { date, roomNumber, timezoneOffset: timezoneOffsetStr, showAllUsers } = req.query; // date format YYYY-MM-DD

        try {
            // Only filter by userId if not showing all users
            const query = showAllUsers === 'true' ? {} : { userId: req.user.id };
            
            console.log(`[Export CSV] showAllUsers=${showAllUsers}, using query:`, query);

            if (roomNumber) {
                query.roomNumber = roomNumber;
            }

            if (date) {
                // Validate date format (YYYY-MM-DD)
                if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                    return res.status(400).json({ message: 'Invalid date format. Please use YYYY-MM-DD.' });
                }
                let startDate = new Date(date + 'T00:00:00.000Z');
                let endDate = new Date(date + 'T23:59:59.999Z');
                
                if (isNaN(startDate.getTime())) { // Check if the base date string itself is valid
                     return res.status(400).json({ message: 'Invalid date value.'});
                }

                if (timezoneOffsetStr) {
                    const timezoneOffsetMinutes = parseInt(timezoneOffsetStr, 10);
                    if (!isNaN(timezoneOffsetMinutes)) {
                        // timezoneOffset from client is new Date().getTimezoneOffset()
                        // This offset is the difference in minutes between UTC and local time.
                        // Positive for timezones west of UTC (e.g., 300 for America/New_York which is UTC-5 during standard time).
                        // The 'date' (e.g., "2025-05-17") represents a day in the user's local timezone.
                        // The start of this local day (e.g., "2025-05-17T00:00:00" local) needs to be converted to UTC.
                        // If user's local time is L, and offset_from_getTimezoneOffset is O (e.g. 300 for EST),
                        // then L = UTC - O (e.g. EST = UTC - 5 hours = UTC - 300 minutes)
                        // So, UTC = L + O.
                        // The query needs UTC timestamps.
                        // startDate and endDate are initially the start/end of the 'date' in UTC (00:00Z to 23:59Z).
                        // To find the equivalent UTC range for the user's local day, we add the offset.
                        // E.g., if date is "2025-05-17", offset is 300 (UTC-5):
                        // User's 2025-05-17T00:00:00 local = 2025-05-17T05:00:00Z.
                        // User's 2025-05-17T23:59:59 local = 2025-05-18T04:59:59Z.
                        // So, we take the initial UTC day (2025-05-17T00Z) and add 5 hours to get the start of the query range in UTC.
                        const offsetMilliseconds = timezoneOffsetMinutes * 60 * 1000;
                        
                        startDate = new Date(startDate.getTime() + offsetMilliseconds);
                        endDate = new Date(endDate.getTime() + offsetMilliseconds);
                    } else {
                        // Optional: log a warning or handle error if timezoneOffset is not a valid number
                        console.warn(`[Export by Date] Received invalid timezoneOffset: ${timezoneOffsetStr}. Proceeding without offset adjustment.`);
                    }
                }
                query.scannedAt = { $gte: startDate, $lte: endDate };
            }
            
            const tags = await AssetTags.find(query).sort({ scannedAt: -1 }).toArray();

            if (tags.length === 0) {
                return res.status(404).json({ message: 'No tags found for the given criteria.' });
            }

            // Dynamically import json2csv
            const { Parser } = await import('json2csv');

            const fields = [
                { label: 'Room Number', value: 'roomNumber', default: 'N/A' },
                { label: 'Asset Tag', value: 'assetTag' },
                { label: 'Asset URL', value: 'assetUrl' },
                { label: 'Date Recorded', value: (row) => new Date(row.scannedAt).toISOString() }
            ];
            const json2csvParser = new Parser({ fields, header: true });
            const csv = json2csvParser.parse(tags);

            res.header('Content-Type', 'text/csv');
            const fileNameDate = date ? `_${date}` : roomNumber ? `_room_${roomNumber}` : '_all';
            res.attachment(`asset_tags_export${fileNameDate}.csv`);
            res.send(csv);

        } catch (err) {
            console.error('Error exporting asset tags:', err);
            // Check for json2csv specific errors if any, though it's less common to have specific named errors here
            if (err.message.includes('json2csv')) {
                 return res.status(500).send('Error during CSV conversion.');
            }
            res.status(500).send('Server error');
        }
    });

    return router;
} 