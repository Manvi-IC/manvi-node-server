import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyIO from 'fastify-socket.io';
import fastifyCompress from '@fastify/compress';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Message from './models/Message.js';
import Task from './models/Task.js';
import Admin from './models/Admin.js';
import SiteSettings from './models/SiteSettings.js';
import bcrypt from 'bcryptjs';

// Function to get tenant models dynamically
const getTenantModels = (dbName) => {
  if (!dbName || dbName === 'm5clogs') {
    return { Message, Task, Admin, SiteSettings };
  }
  const tenantDb = mongoose.connection.useDb(dbName, { useCache: true });
  return {
    Message: tenantDb.models.Message || tenantDb.model('Message', Message.schema),
    Task: tenantDb.models.Task || tenantDb.model('Task', Task.schema),
    Admin: tenantDb.models.Admin || tenantDb.model('Admin', Admin.schema),
    SiteSettings: tenantDb.models.SiteSettings || tenantDb.model('SiteSettings', SiteSettings.schema)
  };
};

// Load environment variables
dotenv.config();

// Fail-fast Environment Validation
if (!process.env.MONGODB_URI) {
  console.error("FATAL ERROR: MONGODB_URI is not defined in the environment variables.");
  process.exit(1);
}

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info'
  }
});

// --- CROSS-ORIGIN CONFIGURATION ---
const frontendUrl = process.env.FRONTEND_URL || "*";

// Main API CORS
fastify.register(fastifyCors, {
  origin: frontendUrl === "*" ? true : [frontendUrl],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
});

// Real-time (Socket.io) CORS & Transports
fastify.register(fastifyIO, {
  cors: {
    origin: frontendUrl,
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ["websocket"]
});

// Compress JSON HTTP payloads over 1KB
fastify.register(fastifyCompress, { threshold: 1024 });

// Health check route
fastify.get('/', {
  schema: {
    response: {
      200: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          version: { type: 'string' }
        }
      }
    }
  }
}, async (request, reply) => {
  return { status: 'M5 Node Server is Running', version: '1.0.0' };
});

// --- SITE SETTINGS API ROUTES ---
fastify.get('/site-settings', async (request, reply) => {
  const dbName = request.headers['x-database'];
  if (!dbName) {
    return reply.status(400).send({ success: false, message: 'x-database header is required' });
  }

  try {
    const { SiteSettings } = getTenantModels(dbName);
    let settings = await SiteSettings.findOne();
    if (!settings) {
      settings = await SiteSettings.create({});
    }
    return { success: true, data: settings };
  } catch (error) {
    return reply.status(500).send({ success: false, message: 'Failed to fetch settings' });
  }
});

fastify.put('/site-settings', async (request, reply) => {
  const dbName = request.headers['x-database'];
  if (!dbName) {
    return reply.status(400).send({ success: false, message: 'x-database header is required' });
  }

  try {
    const { SiteSettings } = getTenantModels(dbName);
    const updated = await SiteSettings.findOneAndUpdate({}, request.body, { new: true, upsert: true });
    return { success: true, data: updated };
  } catch (error) {
    return reply.status(500).send({ success: false, message: 'Failed to update settings' });
  }
});

// --- ADMIN LOGIN ---
fastify.post('/admin/login', async (request, reply) => {
  const dbName = request.headers['x-database'];
  if (!dbName) {
    return reply.status(400).send({ success: false, message: 'x-database header is required' });
  }

  try {
    const { username, password } = request.body;
    const { Admin } = getTenantModels(dbName);
    
    // Auto-seed admin if none exist
    const adminCount = await Admin.countDocuments();
    if (adminCount === 0) {
      const hash = await bcrypt.hash('password', 10);
      await Admin.create({ username: 'admin', passwordHash: hash });
    }

    const admin = await Admin.findOne({ username });
    if (!admin) {
      return reply.status(401).send({ success: false, message: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, admin.passwordHash);
    if (!match) {
      return reply.status(401).send({ success: false, message: 'Invalid credentials' });
    }

    return { success: true, message: 'Login successful' };
  } catch (error) {
    return reply.status(500).send({ success: false, message: 'Login failed' });
  }
});

// --- CHAT API ROUTES ---

// 1. Get Recent Conversations (WhatsApp Style Aggregation)
fastify.get('/chat/recent-users', {
  schema: {
    querystring: {
      type: 'object',
      required: ['userId'],
      properties: {
        userId: { type: 'string' }
      }
    },
    response: {
      200: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                _id: { type: ['string', 'null'] },
                lastMessage: { type: ['string', 'null'] },
                lastTimestamp: { type: ['string', 'object', 'null'] }
              }
            }
          }
        }
      }
    }
  }
}, async (request, reply) => {
  const { userId } = request.query;
  try {
    const recentConversations = await Message.aggregate([
      // Find all messages involving the user
      { $match: { $or: [{ senderId: userId }, { receiverId: userId }] } },
      // Sort by newest first
      { $sort: { timestamp: -1 } },
      // Group by the "other person" in the chat
      {
        $group: {
          _id: {
            $cond: [
              { $eq: ["$senderId", userId] },
              "$receiverId",
              "$senderId"
            ]
          },
          lastMessage: { $first: "$text" },
          lastTimestamp: { $first: "$timestamp" }
        }
      },
      // Sort the final list by the timestamp of the last message
      { $sort: { lastTimestamp: -1 } }
    ]);

    return { success: true, data: recentConversations };
  } catch (error) {
    reply.status(500);
    return { success: false, message: error.message };
  }
});

// 2. Get Unread Message Counts per User
fastify.get('/chat/unread-counts', {
  schema: {
    querystring: {
      type: 'object',
      required: ['userId'],
      properties: {
        userId: { type: 'string' }
      }
    },
    response: {
      200: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            additionalProperties: { type: 'integer' }
          }
        }
      }
    }
  }
}, async (request, reply) => {
  const { userId } = request.query;
  try {
    const unreadCounts = await Message.aggregate([
      {
        $match: {
          receiverId: userId,
          read: false,
          type: 'private'
        }
      },
      {
        $group: {
          _id: "$senderId",
          count: { $sum: 1 }
        }
      }
    ]);

    const counts = {};
    unreadCounts.forEach(item => {
      if (item._id) {
        counts[item._id] = item.count;
      }
    });

    return { success: true, data: counts };
  } catch (error) {
    reply.status(500);
    return { success: false, message: error.message };
  }
});

// Mark messages as read
fastify.post('/chat/mark-read', {
  schema: {
    body: {
      type: 'object',
      required: ['userId', 'senderId'],
      properties: {
        userId: { type: 'string' },
        senderId: { type: 'string' }
      }
    },
    response: {
      200: {
        type: 'object',
        properties: {
          success: { type: 'boolean' }
        }
      }
    }
  }
}, async (request, reply) => {
  const { userId, senderId } = request.body;
  try {
    await Message.updateMany(
      { receiverId: userId, senderId: senderId, read: false },
      { $set: { read: true } }
    );
    return { success: true };
  } catch (error) {
    reply.status(500);
    return { success: false, message: error.message };
  }
});

// Get Unread Task Count
fastify.get('/tasks/unread-count', {
  schema: {
    querystring: {
      type: 'object',
      required: ['userId'],
      properties: {
        userId: { type: 'string' }
      }
    },
    response: {
      200: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          count: { type: 'integer' }
        }
      }
    }
  }
}, async (request, reply) => {
  const { userId } = request.query;
  try {
    const unreadCount = await Task.countDocuments({
      "assignedTo.userId": userId,
      isRead: false,
      status: { $ne: "completed" }
    });
    return { success: true, count: unreadCount };
  } catch (error) {
    reply.status(500);
    return { success: false, message: error.message };
  }
});

// Trigger a real-time Task count push to the user's socket
fastify.post('/tasks/trigger-update', {
  schema: {
    body: {
      type: 'object',
      required: ['userId'],
      properties: {
        userId: { type: 'string' }
      }
    },
    response: {
      200: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          count: { type: 'integer' }
        }
      }
    }
  }
}, async (request, reply) => {
  const { userId } = request.body;
  try {
    const unreadCount = await Task.countDocuments({
      "assignedTo.userId": userId,
      isRead: false,
      status: { $ne: "completed" }
    });
    
    fastify.io.to(userId).emit('task_unread_count', { count: unreadCount });
    return { success: true, count: unreadCount };
  } catch (error) {
    reply.status(500);
    return { success: false, message: error.message };
  }
});

// Chat History Route
fastify.get('/chat/history', {
  schema: {
    querystring: {
      type: 'object',
      required: ['type'],
      properties: {
        user1: { type: 'string' },
        user2: { type: 'string' },
        type: { type: 'string' }
      }
    },
    response: {
      200: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                _id: { type: 'string' },
                senderId: { type: 'string' },
                senderName: { type: 'string' },
                receiverId: { type: 'string' },
                receiverName: { type: 'string' },
                text: { type: 'string' },
                title: { type: 'string' },
                priority: { type: 'string' },
                type: { type: 'string' },
                timestamp: { type: ['string', 'object'] },
                read: { type: 'boolean' },
                __v: { type: 'integer' }
              }
            }
          }
        }
      }
    }
  }
}, async (request, reply) => {
  const { user1, user2, type } = request.query;
  try {
    if (type === 'broadcast') {
      const messages = await Message.find({ type: 'broadcast' })
        .sort({ timestamp: 1 })
        .limit(100)
        .lean();
      return { success: true, data: messages };
    }
    
    const messages = await Message.find({
      $or: [
        { senderId: user1, receiverId: user2 },
        { senderId: user2, receiverId: user1 }
      ]
    })
    .sort({ timestamp: 1 })
    .limit(100)
    .lean();
    
    return { success: true, data: messages };
  } catch (error) {
    reply.status(500);
    return { success: false, message: error.message };
  }
});

// Database Connection
const connectDB = async () => {
  try {
    // Register connection state event handlers for production monitoring
    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB disconnected! Attempting to reconnect...');
    });
    mongoose.connection.on('error', (err) => {
      console.error(`MongoDB connection error: ${err.message}`);
    });

    const conn = await mongoose.connect(process.env.MONGODB_URI);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

// Start Server
const start = async () => {
  try {
    await connectDB();
    const port = process.env.PORT || 5000;
    await fastify.listen({ port, host: '0.0.0.0' });
    
    console.log(`Server listening on http://localhost:${port}`);

// --- REAL-TIME EVENT HANDLING (SOCKET.IO) ---
const userSockets = new Map(); // userId -> Set(socket.id)
const userStatuses = new Map(); // userId -> 'online' | 'away'

fastify.ready((err) => {
  if (err) throw err;

  fastify.io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Join a private room based on userId for targeted messaging
    socket.on('join_chat', async (userId) => {
      // Safety check: clean up previous userId on this socket to prevent memory leaks
      if (socket.userId && socket.userId !== userId) {
        const oldUserId = socket.userId;
        if (userSockets.has(oldUserId)) {
          userSockets.get(oldUserId).delete(socket.id);
          if (userSockets.get(oldUserId).size === 0) {
            userSockets.delete(oldUserId);
            userStatuses.delete(oldUserId);
            fastify.io.emit('status_update', { userId: oldUserId, status: 'offline' });
          }
        }
      }

      socket.join(userId);
      socket.userId = userId;

      if (!userSockets.has(userId)) {
         userSockets.set(userId, new Set());
      }
      userSockets.get(userId).add(socket.id);
      
      userStatuses.set(userId, 'online');
      fastify.io.emit('status_update', { userId, status: 'online' });
      
      // Send current statuses to the newly joined user
      socket.emit('all_statuses', Object.fromEntries(userStatuses));

      // Push initial unread task count on connect
      try {
        const unreadCount = await Task.countDocuments({
          "assignedTo.userId": userId,
          isRead: false,
          status: { $ne: "completed" }
        });
        socket.emit('task_unread_count', { count: unreadCount });
      } catch (err) {
        console.error("Failed to push initial task count:", err);
      }

      console.log(`User ${userId} joined their chat room`);
    });

    // Handle manual status changes (e.g. going away)
    socket.on('set_status', (data) => {
       const { userId, status } = data;
       if (userId && userSockets.has(userId)) {
          userStatuses.set(userId, status);
          fastify.io.emit('status_update', { userId, status });
       }
    });

    // Handle outgoing messages
    socket.on('send_message', async (data) => {
      try {
        // Save message to MongoDB
        const newMessage = new Message({
          senderId: data.senderId,
          senderName: data.senderName,
          receiverId: data.receiverId,
          receiverName: data.receiverName,
          text: data.text,
          type: data.type || 'private',
          title: data.title,
          priority: data.priority || 'normal'
        });
        
        await newMessage.save();

        // Broadcast to everyone (for Team announcements)
        if (data.type === 'broadcast') {
          fastify.io.emit('receive_message', newMessage);
        } 
        // Or send only to the specific receiver and back to the sender
        else {
          fastify.io.to(data.receiverId).to(data.senderId).emit('receive_message', newMessage);
        }
      } catch (error) {
        console.error('Socket Error (send_message):', error);
        // UX optimization: Send error feedback back to the sender socket
        socket.emit('send_message_error', {
          senderId: data.senderId,
          receiverId: data.receiverId,
          text: data.text,
          error: 'Failed to send/save message'
        });
      }
    });

        socket.on('disconnect', () => {
          console.log('User disconnected:', socket.id);
          const userId = socket.userId;
          if (userId && userSockets.has(userId)) {
            userSockets.get(userId).delete(socket.id);
            if (userSockets.get(userId).size === 0) {
              userSockets.delete(userId);
              userStatuses.delete(userId);
              fastify.io.emit('status_update', { userId, status: 'offline' });
            }
          }
        });
      });
    });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

// --- GRACEFUL SHUTDOWN HANDLERS ---
const closeGracefully = async (signal) => {
  console.log(`\n[${signal}] Initiating graceful shutdown...`);
  try {
    await fastify.close();
    console.log('Fastify server closed successfully.');
    
    await mongoose.connection.close();
    console.log('MongoDB connection closed successfully.');
    
    process.exit(0);
  } catch (err) {
    console.error('Error during graceful shutdown:', err);
    process.exit(1);
  }
};

process.on('SIGINT', () => closeGracefully('SIGINT'));
process.on('SIGTERM', () => closeGracefully('SIGTERM'));
