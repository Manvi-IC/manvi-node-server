import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyIO from 'fastify-socket.io';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const fastify = Fastify({
  logger: true
});

// Register CORS
fastify.register(fastifyCors, {
  origin: true, // In production, replace with your frontend domains
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
});

// Register Socket.io
fastify.register(fastifyIO, {
  cors: {
    origin: "*", // In production, restrict this
    methods: ["GET", "POST"]
  }
});

// Health check route
fastify.get('/', async (request, reply) => {
  return { status: 'M5 Node Server is Running', version: '1.0.0' };
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
    // Connect to DB first
    await connectDB();

    // Start Fastify
    const port = process.env.PORT || 5000;
    await fastify.listen({ port, host: '0.0.0.0' });
    
    console.log(`Server listening on http://localhost:${port}`);

    // Socket.io Handlers
    fastify.ready((err) => {
      if (err) throw err;

      fastify.io.on('connection', (socket) => {
        console.log('A user connected:', socket.id);

        socket.on('disconnect', () => {
          console.log('User disconnected:', socket.id);
        });

        // Test message
        socket.emit('server_ready', { message: 'Connected to M5 Real-time Server' });
      });
    });

  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
