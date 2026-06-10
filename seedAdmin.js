import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import Admin from './models/Admin.js';

dotenv.config();

const seedAdmin = async () => {
  try {
    // We are targeting the "manvi" database as specified in the .env or directly
    const uri = process.env.MONGODB_URI.replace('/m5clogs?', '/manvi?');
    console.log("Connecting to:", uri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')); // hide credentials
    
    await mongoose.connect(uri);
    console.log('Connected to MongoDB (manvi)');

    // Check if admin already exists
    const existingAdmin = await Admin.findOne({ username: 'admin' });
    if (existingAdmin) {
      console.log('Admin user already exists. Exiting.');
      process.exit(0);
    }

    const hashedPassword = await bcrypt.hash('admin123', 10);
    
    const admin = new Admin({
      username: 'admin',
      password: hashedPassword
    });

    await admin.save();
    console.log('Successfully created initial admin user (username: admin, password: admin123)');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding admin user:', error);
    process.exit(1);
  }
};

seedAdmin();
