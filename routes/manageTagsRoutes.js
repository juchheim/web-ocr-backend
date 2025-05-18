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
        const { date, roomNumber } = req.query; // date format YYYY-MM-DD

        try {
            const query = { userId: req.user.id };

            if (roomNumber) {
                query.roomNumber = roomNumber;
            }

            if (date) {
                // Validate date format (YYYY-MM-DD)
                if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                    return res.status(400).json({ message: 'Invalid date format. Please use YYYY-MM-DD.' });
                }
                const startDate = new Date(date + 'T00:00:00.000Z');
                const endDate = new Date(date + 'T23:59:59.999Z');
                if (isNaN(startDate.getTime())) {
                     return res.status(400).json({ message: 'Invalid date value.'});
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