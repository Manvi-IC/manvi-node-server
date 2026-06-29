import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const BlogSchema = new mongoose.Schema({
  title: String,
  slug: String,
  content: Array
});

const Blog = mongoose.models.Blog || mongoose.model("Blog", BlogSchema);

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to DB");
  const blogs = await Blog.find({});
  for (const b of blogs) {
    if (b.slug === "how-to-send-rakhi-abroad-from-india") {
      console.log("SLUG:", b.slug);
      for (const block of b.content) {
        console.log("BLOCK:", JSON.stringify(block, null, 2));
      }
    }
  }
  await mongoose.disconnect();
}

run().catch(console.error);
