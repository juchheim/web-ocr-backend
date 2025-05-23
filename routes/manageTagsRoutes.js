import express from 'express';
import { protect as protectRoute, adminProtect } from './auth.js';
import mongoose from 'mongoose'; // Needed for ObjectId
import jwt from 'jsonwebtoken'; // Import JWT at the top instead of dynamic import
// import { Parser } from 'json2csv'; // For CSV export

// Store active SSE connections
const sseConnections = new Map(); // userId -> Set of response objects

// This function accepts the db instance (Mongoose connection) as an argument
export default function createManageTagsRoutes(db) {
    const router = express.Router();

    // router.use(protectRoute); // Removed global protectRoute, apply per-route

    // Get the AssetTags collection
    const AssetTags = db.collection('asset_tags');

    // @route   GET /api/manage/tags
    // @desc    Get all asset tags for the logged-in user, optionally filtered
    // @access  Private
    router.get('/', protectRoute, async (req, res) => {
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
    // @desc    Get asset tags for all users
    // @access  Private (Any authenticated user)
    router.get('/all', protectRoute, async (req, res) => {
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
    router.delete('/', protectRoute, async (req, res) => {
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
    router.get('/export', protectRoute, async (req, res) => {
        const { date, roomNumber, timezoneOffset: timezoneOffsetStr, showAllUsers } = req.query; // date format YYYY-MM-DD

        try {
            let query = {};
            if (showAllUsers === 'true') {
                // Allow any authenticated user to see all tags - removed admin check
                // query remains empty to fetch all
                console.log(`[Export CSV] Exporting all users' data by user: ${req.user.email}`);
            } else {
                query.userId = req.user.id;
            }
            
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
            console.log(`[Export CSV] Found ${tags.length} tags for export query:`, query);

            if (tags.length === 0) {
                return res.status(404).json({ message: 'No tags found for the given criteria.' });
            }

            try {
                // Dynamically import json2csv
                console.log('[Export CSV] Importing json2csv module...');
                const { Parser } = await import('json2csv');
                console.log('[Export CSV] Successfully imported json2csv module');

                const fields = [
                    { label: 'Room Number', value: 'roomNumber', default: 'N/A' },
                    { label: 'Asset Tag', value: 'assetTag' },
                    { label: 'Asset URL', value: 'assetUrl' },
                    { label: 'Date Recorded', value: (row) => new Date(row.scannedAt).toISOString() }
                ];
                console.log('[Export CSV] Creating parser with fields:', fields);
                const json2csvParser = new Parser({ fields, header: true });
                
                // Validate tags data structure before parsing to catch issues early
                console.log('[Export CSV] Validating tags data. First tag sample:', JSON.stringify(tags[0]).substring(0, 200));
                
                console.log('[Export CSV] Parsing tags to CSV...');
                const csv = json2csvParser.parse(tags);
                console.log(`[Export CSV] Successfully parsed ${tags.length} tags to CSV format`);

                res.header('Content-Type', 'text/csv');
                const fileNameDate = date ? `_${date}` : roomNumber ? `_room_${roomNumber}` : '_all';
                res.attachment(`asset_tags_export${fileNameDate}.csv`);
                res.send(csv);
                console.log('[Export CSV] CSV successfully sent to client');
            } catch (error) {
                console.error('[Export CSV] Error in CSV generation:', error);
                throw error; // Let the outer catch handle it
            }
        } catch (err) {
            console.error('Error exporting asset tags:', err);
            console.error('[Export CSV] Stack trace:', err.stack);
            // Check for json2csv specific errors if any, though it's less common to have specific named errors here
            if (err.message.includes('json2csv')) {
                 return res.status(500).json({ message: 'Error during CSV conversion.', details: err.message });
            }
            res.status(500).json({ message: 'Server error', details: err.message });
        }
    });

    // @route   PUT /api/manage/tags/:id
    // @desc    Update assetTag and/or roomNumber for a tag
    // @access  Private
    router.put('/:id', protectRoute, async (req, res) => {
        const { id } = req.params;
        const { assetTag, roomNumber } = req.body;
        if (!assetTag && !roomNumber) {
            return res.status(400).json({ message: 'No fields to update.' });
        }
        try {
            const objectId = new mongoose.Types.ObjectId(id);
            // Only allow update if the tag belongs to the user
            const query = { _id: objectId, userId: req.user.id };
            const update = {};
            if (assetTag !== undefined) update.assetTag = assetTag;
            if (roomNumber !== undefined) update.roomNumber = roomNumber;
            
            const result = await AssetTags.findOneAndUpdate(query, { $set: update }, { returnDocument: 'after' });
            
            // Handle both newer and older MongoDB driver result formats
            if (!result && !result?.value) {
                return res.status(404).json({ message: 'Tag not found or not owned by user.' });
            }
            
            // Return the updated document, accommodating different driver versions
            const updatedTag = result.value || result;
            res.json({ message: 'Tag updated successfully.', tag: updatedTag });
        } catch (err) {
            console.error('Error updating asset tag:', err);
            if (err.name === 'BSONTypeError' || err.name === 'CastError') {
                return res.status(400).json({ message: 'Invalid ID format provided.' });
            }
            res.status(500).json({ message: 'Server error' });
        }
    });

    // @route   GET /api/manage/tags/stream
    // @desc    Server-Sent Events endpoint for streaming new asset tags
    // @access  Private (token via query parameter since EventSource doesn't support headers)
    router.get('/stream', async (req, res) => {
        try {
            // Get token from query parameter since EventSource doesn't support custom headers
            const token = req.query.token;
            const showAllUsers = req.query.showAllUsers === 'true';
            
            console.log('[SSE] Stream connection attempt with showAllUsers:', showAllUsers);
            console.log('[SSE] Token present:', !!token);
            
            if (!token) {
                console.log('[SSE] No token provided in query parameter');
                return res.status(401).json({ message: 'Access token required' });
            }

            // Check if the token is a string like 'null' or 'undefined'
            if (token === 'null' || token === 'undefined') {
                console.log('[SSE] Token is null or undefined string');
                return res.status(401).json({ message: 'Invalid token format' });
            }

            // Use the same JWT secret as other routes
            const jwtSecret = process.env.JWT_SECRET;
            if (!jwtSecret) {
                console.error('[SSE] JWT_SECRET not found in environment');
                return res.status(500).json({ message: 'Server configuration error' });
            }
            
            let decoded;
            try {
                decoded = jwt.verify(token, jwtSecret);
                console.log('[SSE] Token verified successfully for user:', decoded.id);
            } catch (jwtErr) {
                console.log('[SSE] JWT verification failed:', jwtErr.name, jwtErr.message);
                if (jwtErr.name === 'TokenExpiredError') {
                    return res.status(401).json({ message: 'Token has expired' });
                } else if (jwtErr.name === 'JsonWebTokenError') {
                    return res.status(401).json({ message: 'Invalid token' });
                } else {
                    return res.status(401).json({ message: 'Token verification failed' });
                }
            }

            const userId = decoded.id;
            console.log('[SSE] Setting up SSE connection for userId:', userId, 'showAllUsers:', showAllUsers);
            
            // Set up SSE headers
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Cache-Control'
            });

            // Initialize connection tracking
            const connectionKey = showAllUsers ? 'all' : userId;
            if (!sseConnections.has(connectionKey)) {
                sseConnections.set(connectionKey, new Set());
            }
            sseConnections.get(connectionKey).add(res);

            console.log(`[SSE] New connection for ${showAllUsers ? 'all users' : `user ${userId}`}. Total connections: ${sseConnections.get(connectionKey).size}`);

            // Send initial connection confirmation
            res.write(`data: ${JSON.stringify({ type: 'connected', message: 'SSE connection established' })}\n\n`);

            // Clean up on client disconnect
            req.on('close', () => {
                if (sseConnections.has(connectionKey)) {
                    sseConnections.get(connectionKey).delete(res);
                    console.log(`[SSE] Connection closed for ${showAllUsers ? 'all users' : `user ${userId}`}. Remaining connections: ${sseConnections.get(connectionKey).size}`);
                    
                    // Clean up empty connection sets
                    if (sseConnections.get(connectionKey).size === 0) {
                        sseConnections.delete(connectionKey);
                    }
                }
            });
        } catch (err) {
            console.error('[SSE] Error setting up connection:', err);
            res.status(500).json({ message: 'Internal server error' });
        }
    });

    // Function to broadcast new tag to SSE connections
    function broadcastNewTag(tag) {
        console.log(`[SSE] Broadcasting new tag: ${tag.assetTag} by user ${tag.userId}`);
        console.log(`[SSE] Current SSE connections: ${Array.from(sseConnections.keys()).join(', ')}`);
        console.log(`[SSE] Connection counts: ${Array.from(sseConnections.entries()).map(([key, set]) => `${key}: ${set.size}`).join(', ')}`);
        
        // Broadcast to user's own connections
        if (sseConnections.has(tag.userId)) {
            const userConnections = sseConnections.get(tag.userId);
            console.log(`[SSE] Broadcasting to ${userConnections.size} user-specific connections for user ${tag.userId}`);
            userConnections.forEach(res => {
                try {
                    res.write(`data: ${JSON.stringify({ type: 'newTag', tag })}\n\n`);
                    console.log(`[SSE] Successfully sent to user connection`);
                } catch (err) {
                    console.error('[SSE] Error writing to user connection:', err);
                    userConnections.delete(res);
                }
            });
        } else {
            console.log(`[SSE] No user-specific connections found for user ${tag.userId}`);
        }

        // Broadcast to "all users" connections
        if (sseConnections.has('all')) {
            const allConnections = sseConnections.get('all');
            console.log(`[SSE] Broadcasting to ${allConnections.size} "all users" connections`);
            allConnections.forEach(res => {
                try {
                    res.write(`data: ${JSON.stringify({ type: 'newTag', tag })}\n\n`);
                    console.log(`[SSE] Successfully sent to all-users connection`);
                } catch (err) {
                    console.error('[SSE] Error writing to all-users connection:', err);
                    allConnections.delete(res);
                }
            });
        } else {
            console.log(`[SSE] No "all users" connections found`);
        }
    }

    // Expose the broadcast function so it can be used by other routes
    router.broadcastNewTag = broadcastNewTag;

    return router;
} 