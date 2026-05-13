import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  senderId: { type: String, required: true },
  senderName: { type: String, required: true },
  receiverId: { type: String, required: true }, // 'broadcast' for team-wide
  receiverName: { type: String, required: true },
  text: { type: String, required: true },
  type: { type: String, enum: ['private', 'broadcast'], default: 'private' },
  timestamp: { type: Date, default: Date.now },
  read: { type: Boolean, default: false }
});

const Message = mongoose.model('Message', messageSchema);
export default Message;
