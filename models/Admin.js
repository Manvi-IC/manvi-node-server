import mongoose from 'mongoose';

const adminSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
  },
  passwordHash: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: ['admin', 'salesperson'],
    default: 'admin',
  },
}, { timestamps: true });

const Admin = mongoose.model('Admin', adminSchema);

export default Admin;
