import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyIO from 'fastify-socket.io';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Message from './models/Message.js';

// Load environment variables
dotenv.config();

const fastify = Fastify({
  logger: true
});

// Register CORS
const frontendUrl = process.env.FRONTEND_URL || "*";

fastify.register(fastifyCors, {
  origin: frontendUrl === "*" ? true : [frontendUrl],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
});

// Register Socket.io
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

// Get list of users who have had conversations with current user (Optimized with Aggregation)
fastify.get('/chat/recent-users', async (request, reply) => {
  const { userId } = request.query;
  try {
    const recentConversations = await Message.aggregate([
      { 
        $match: { 
          $or: [{ senderId: userId }, { receiverId: userId }],
          type: 'private' 
        } 
      },
      { $sort: { timestamp: -1 } }, // Sort to get latest messages first
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
      { $sort: { lastTimestamp: -1 } } // Sort conversation list by most recent activity
    ]);

    return { success: true, data: recentConversations };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

// Get unread counts for a user
fastify.get('/chat/unread-counts', async (request, reply) => {
  const { userId } = request.query;
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

// Chat History Route
fastify.get('/chat/history', async (request, reply) => {
  const { user1, user2, type } = request.query;
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

    fastify.ready((err) => {
      if (err) throw err;

      fastify.io.on('connection', (socket) => {
        console.log('A user connected:', socket.id);

        socket.on('join_chat', (userId) => {
          socket.join(userId);
          console.log(`User ${userId} joined their chat room`);
        });

        socket.on('send_message', async (data) => {
          try {
            const newMessage = new Message({
              senderId: data.senderId,
              senderName: data.senderName,
              receiverId: data.receiverId,
              receiverName: data.receiverName,
              text: data.text,
              type: data.type || 'private'
            });
            
            await newMessage.save();

            if (data.type === 'broadcast') {
              fastify.io.emit('receive_message', newMessage);
            } else {
              fastify.io.to(data.receiverId).to(data.senderId).emit('receive_message', newMessage);
            }
          } catch (error) {
            console.error('Socket Error (send_message):', error);
          }
        });

        socket.on('disconnect', () => {
          console.log('User disconnected:', socket.id);
        });
      });
    });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
