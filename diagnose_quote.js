import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const walkinRateSchema = new mongoose.Schema({
  uploadId: String, shipper: String, network: String,
  service: String, type: String, minWt: Number, maxWt: Number,
  zones: { type: Map, of: Number },
}, { timestamps: true });

const WalkinRate = mongoose.model("WalkinRate", walkinRateSchema);

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ Connected to DB:", mongoose.connection.name);

  // Show all distinct zone key combinations per service
  const services = await WalkinRate.distinct("service");
  for (const svc of services) {
    const docs = await WalkinRate.find({ service: svc }).limit(5).lean();
    const zonesPerDoc = docs.map(d => {
      const zm = d.zones instanceof Map ? Object.fromEntries(d.zones) : d.zones;
      return Object.keys(zm || {});
    });
    console.log(`\n"${svc}": zone keys in first 5 docs → ${JSON.stringify(zonesPerDoc)}`);
    console.log(`  count=${await WalkinRate.countDocuments({ service: svc })}`);
  }

  await mongoose.disconnect();
  console.log("\n✅ Done");
}
run().catch(e => { console.error(e); process.exit(1); });
