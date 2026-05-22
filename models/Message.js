import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  senderId: { type: String, required: true },
  senderName: { type: String, required: true },
  receiverId: { type: String, required: true }, // 'broadcast' for team-wide
  receiverName: { type: String, required: true },
  text: { type: String, required: true },
  title: { type: String }, // For broadcasts
  priority: { type: String, enum: ['normal', 'important', 'urgent'], default: 'normal' }, // For broadcasts
  type: { type: String, enum: ["private", "broadcast"], default: "private" },
  timestamp: { type: Date, default: Date.now },
  read: { type: Boolean, default: false },
});

// Optimization: Compound indexes for fast history and search queries
messageSchema.index({ senderId: 1, receiverId: 1, timestamp: -1 });
messageSchema.index({ receiverId: 1, read: 1 }); // Fast unread count fetching
messageSchema.index({ timestamp: -1 }); // Fast sorting for recent lists
messageSchema.index({ senderId: 1, timestamp: -1 }); // Fast recent conversation querying
messageSchema.index({ receiverId: 1, timestamp: -1 }); // Fast recent conversation querying

const Message = mongoose.model("Message", messageSchema);
export default Message;
