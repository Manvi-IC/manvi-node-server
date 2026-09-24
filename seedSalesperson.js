import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import Admin from './models/Admin.js';

dotenv.config();

const seedSalesperson = async () => {
  try {
    const uri = process.env.MONGODB_URI;
    console.log("Connecting to MongoDB...");
    await mongoose.connect(uri);
    console.log('Connected to MongoDB');

    const username = 'sales@manvi';
    const password = 'Salesperson@MIC';
    const hashedPassword = await bcrypt.hash(password, 10);

    // Clean up previous test/temporary user if present
    await Admin.deleteMany({
      username: { $in: ['sales@manvi.com', 'sales@manvi'] }
    });

    await Admin.create({
      username: username.toLowerCase(),
      passwordHash: hashedPassword,
      role: 'salesperson'
    });

    console.log(`Successfully set salesperson user (${username}) with role: salesperson`);
    process.exit(0);
  } catch (error) {
    console.error('Error seeding salesperson user:', error);
    process.exit(1);
  }
};

seedSalesperson();
