import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyIO from 'fastify-socket.io';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import Message from './models/Message.js';
import Task from './models/Task.js';
import Admin from './models/Admin.js';
import SiteSettings from './models/SiteSettings.js';

// Load environment variables
dotenv.config();

const fastify = Fastify({
  logger: true
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

// Health check route
fastify.get('/', async (request, reply) => {
  return { status: 'M5 Node Server is Running', version: '1.0.0' };
});

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

// --- SITE SETTINGS API ROUTES ---
fastify.get('/site-settings', async (request, reply) => {
  const dbName = request.headers['x-database'];
  const { SiteSettings } = getTenantModels(dbName);
  try {
    let settings = await SiteSettings.findOne({});
    if (!settings) {
      settings = await SiteSettings.create({});
    }
    return { success: true, data: settings };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

fastify.put('/site-settings', async (request, reply) => {
  const dbName = request.headers['x-database'];
  const { SiteSettings } = getTenantModels(dbName);
  try {
    let settings = await SiteSettings.findOne({});
    if (!settings) {
      settings = new SiteSettings(request.body);
      await settings.save();
    } else {
      settings = await SiteSettings.findOneAndUpdate({}, request.body, { new: true });
    }
    return { success: true, data: settings };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

// --- ADMIN API ROUTES ---
fastify.post('/admin/login', async (request, reply) => {
  const { username, password } = request.body;
  const dbName = request.headers['x-database'];
  const { Admin } = getTenantModels(dbName);
  
  try {
    const adminUser = await Admin.findOne({ username });
    if (!adminUser) {
      return { success: false, message: 'Invalid credentials' };
    }
    
    const isMatch = await bcrypt.compare(password, adminUser.password);
    if (!isMatch) {
      return { success: false, message: 'Invalid credentials' };
    }
    
    return { success: true, message: 'Login successful' };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

// --- CHAT API ROUTES ---

// 1. Get Recent Conversations (WhatsApp Style Aggregation)
fastify.get('/chat/recent-users', async (request, reply) => {
  const { userId } = request.query;
  const dbName = request.headers['x-database'];
  const { Message } = getTenantModels(dbName);
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
    return { success: false, message: error.message };
  }
});

// 2. Get Unread Message Counts per User
fastify.get('/chat/unread-counts', async (request, reply) => {
  const { userId } = request.query;
  const dbName = request.headers['x-database'];
  const { Message } = getTenantModels(dbName);
  try {
    const unreadMessages = await Message.find({
      receiverId: userId,
      read: false,
      type: 'private'
    }).select('senderId');

    const counts = {};
    unreadMessages.forEach(msg => {
      counts[msg.senderId] = (counts[msg.senderId] || 0) + 1;
    });

    return { success: true, data: counts };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

// Mark messages as read
fastify.post('/chat/mark-read', async (request, reply) => {
  const { userId, senderId } = request.body;
  const dbName = request.headers['x-database'];
  const { Message } = getTenantModels(dbName);
  try {
    await Message.updateMany(
      { receiverId: userId, senderId: senderId, read: false },
      { $set: { read: true } }
    );
    return { success: true };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

// Get Unread Task Count
fastify.get('/tasks/unread-count', async (request, reply) => {
  const { userId } = request.query;
  const dbName = request.headers['x-database'];
  const { Task } = getTenantModels(dbName);
  try {
    const unreadCount = await Task.countDocuments({
      "assignedTo.userId": userId,
      isRead: false,
      status: { $ne: "completed" }
    });
    return { success: true, count: unreadCount };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

// Trigger a real-time Task count push to the user's socket
fastify.post('/tasks/trigger-update', async (request, reply) => {
  const { userId } = request.body;
  const dbName = request.headers['x-database'];
  const { Task } = getTenantModels(dbName);
  try {
    const unreadCount = await Task.countDocuments({
      "assignedTo.userId": userId,
      isRead: false,
      status: { $ne: "completed" }
    });
    
    fastify.io.to(userId).emit('task_unread_count', { count: unreadCount });
    return { success: true, count: unreadCount };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

// Chat History Route
fastify.get('/chat/history', async (request, reply) => {
  const { user1, user2, type } = request.query;
  const dbName = request.headers['x-database'];
  const { Message } = getTenantModels(dbName);
  try {
    if (type === 'broadcast') {
      const messages = await Message.find({ type: 'broadcast' })
        .sort({ timestamp: 1 })
        .limit(100);
      return { success: true, data: messages };
    }
    
    const messages = await Message.find({
      $or: [
        { senderId: user1, receiverId: user2 },
        { senderId: user2, receiverId: user1 }
      ]
    })
    .sort({ timestamp: 1 })
    .limit(100);
    
    return { success: true, data: messages };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

// Database Connection
const connectDB = async () => {
  try {
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
    const dbName = socket.handshake.headers['x-database'] || socket.handshake.auth?.database;
    const { Message, Task } = getTenantModels(dbName);

    // Join a private room based on userId for targeted messaging
    socket.on('join_chat', async (userId) => {
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
