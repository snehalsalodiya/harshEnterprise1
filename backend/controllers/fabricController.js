const FabricJob = require("../models/Fabricjob");
const Expense = require("../models/Expense");
const RateConfig = require("../models/rateConfig");
const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");
const twilio = require("twilio");

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const twilioPhoneNumber = "whatsapp:+14155238886";

// 📥 Serve bill by job ID
exports.getBillByJobId = (req, res) => {
  const jobId = req.params.jobId;
  const dir = path.join(__dirname, '../bills');

  if (!fs.existsSync(dir)) return res.status(404).json({ error: "Bill directory not found" });

  const file = fs.readdirSync(dir).find(f => f.includes(jobId) && f.endsWith(".pdf"));
  if (!file) return res.status(404).json({ error: `Bill not found for jobId: ${jobId}` });

  const filePath = path.join(dir, file);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "inline");
  res.sendFile(filePath);
};

// 📜 Serve PDF by filename
exports.getBill = (req, res) => {
  const filePath = path.join(__dirname, "../bills", req.params.fileName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });

  res.setHeader("Content-Disposition", "inline");
  res.setHeader("Content-Type", "application/pdf");
  res.sendFile(filePath);
};

// 🔗 Generate Bill Link by jobId
exports.getBillLink = (req, res) => {
  const jobId = req.params.jobId;
  const dir = path.join(__dirname, "../bills");
  if (!fs.existsSync(dir)) return res.status(404).json({ error: "No bill directory" });

  const file = fs.readdirSync(dir).find(f => f.includes(jobId));
  if (!file) return res.status(404).json({ error: "No bill found" });

  const fullUrl = `${process.env.BASE_URL}/api/fabric/bill/${file}`;
  res.json({ url: fullUrl });
};

// 📲 Send Bill via WhatsApp (manual)
exports.sendBillViaWhatsApp = async (req, res) => {
  const { jobId, number, partyName } = req.body;
  const dir = path.join(__dirname, "../bills");

  if (!fs.existsSync(dir)) return res.status(404).json({ error: "Bill directory not found" });

  const file = fs.readdirSync(dir).find(f => f.includes(jobId) && f.endsWith(".pdf"));
  if (!file) return res.status(404).json({ error: "Bill PDF not found" });

  const fileUrl = `${process.env.BASE_URL}/api/fabric/bill/${file}`;

  try {
    const msg = await client.messages.create({
      from: twilioPhoneNumber,
      to: `whatsapp:+91${number}`,
      body: `Hello ${partyName}, here is your bill for job ${jobId}.`,
      mediaUrl: [fileUrl],
    });

    res.json({ success: true, sid: msg.sid });
  } catch (err) {
    res.status(500).json({ error: "Failed to send WhatsApp", details: err.message });
  }
};


// ✅ NEW: GET /billname/:jobId
exports.getBillNameByJobId = (req, res) => {
  const jobId = req.params.jobId;
  const dir = path.join(__dirname, "../bills");
  if (!fs.existsSync(dir)) {
    return res.status(404).json({ error: "Bill directory not found" });
  }
  const files = fs.readdirSync(dir);
  const file = files.find((f) => f.includes(jobId));
  if (!file) {
    return res.status(404).json({ error: "Bill not found" });
  }
  res.json({ fileName: file });
};

// 📦 Create Job
exports.createJob = async (req, res) => {
  const { partyName, fabricType, quantity, rate, mobileNumber } = req.body;
  if (!partyName || !fabricType || !quantity || !rate || !mobileNumber) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const jobId = "FAB" + Date.now();
    const job = new FabricJob({ jobId, partyName, fabricType, quantity, rate, mobileNumber, deliveryDate: null });
    await job.save();
    res.json({ message: "✅ Job created successfully", job });
  } catch {
    res.status(500).json({ error: "Error creating job" });
  }
};

// 🔄 Update Job Stage
exports.updateStage = async (req, res) => {
  const jobId = req.body.jobId.trim();
  const stage = req.body.stage;

  try {
    const job = await FabricJob.findOne({ jobId });
    if (!job) return res.status(404).json({ error: "Job not found" });

    job.stage = stage;
    await job.save();
    res.json({ message: `✅ Stage updated to ${stage}` });

    if (["coated", "washed"].includes(stage)) {
      const config = await RateConfig.findOne();
      if (config) {
        const rate = stage === "coated" ? config.coatingRate : config.washingRate;
        const amount = job.quantity * rate;
        const gst = amount * 0.05;
        await new Expense({ type: stage, description: `${stage} for ${job.jobId}`, amount, gst }).save();
      }
    }

    if (stage === "delivered") {
      try {
        const filePath = await exports.generatePDFBill(job);
        const billUrl = `${process.env.BASE_URL}/api/fabric/bill/${path.basename(filePath)}`;
        await client.messages.create({
          from: twilioPhoneNumber,
          to: `whatsapp:+91${job.mobileNumber}`,
          body: `Hello ${job.partyName}, your bill for job ${job.jobId} is ready.`,
          mediaUrl: [billUrl],
        });
      } catch (err) {
        console.error("❌ Failed to generate/send bill:", err.message);
      }
    }
  } catch (err) {
    res.status(500).json({ error: "Error updating stage" });
  }
};

// 📜 Scan Job
exports.scanJob = async (req, res) => {
  try {
    const job = await FabricJob.findOne({ jobId: req.body.jobId.trim() });
    if (!job) return res.status(404).json({ error: "Job not found" });

    const stages = ["raw", "coated", "printed", "washed", "packed", "delivered"];
    const currentIdx = stages.indexOf(job.stage);
    const nextStage = stages[currentIdx + 1] || null;

    res.json({
      jobId: job.jobId,
      partyName: job.partyName,
      fabricType: job.fabricType,
      quantity: job.quantity,
      stage: job.stage,
      nextStage,
      mobileNumber: job.mobileNumber
    });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
};

// 🧾 Generate Bill PDF
exports.generatePDFBill = async (job) => {
  const dir = path.join(__dirname, "../bills");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);

  const now = new Date();
  const dateStr = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
  const cleanParty = job.partyName.replace(/\s+/g, "_").toLowerCase();
  const filename = `${cleanParty}_${job.jobId}_${dateStr}.pdf`;
  const filePath = path.join(dir, filename);

  const doc = new PDFDocument({ margin: 40 });
  doc.pipe(fs.createWriteStream(filePath));

  try {
    doc.image(path.join(__dirname, "../Utilities/logo.png"), 250, 30, { width: 100 });
  } catch {}

  doc.fontSize(20).fillColor("#80602f").text("Harsh Enterprise", 35, 120);
  doc.fontSize(13).fillColor("#000")
    .text("ADDRESS : No.33/1, JBJ Compound, Near Dharmesh Dyeing, Khatodra, Surat-395002")
    .text("EMAIL : HarshEnterprise@gmail.com")
    .text("CONTACT : +91-8238271922 | +91-9979526411")
    .text("GSTIN : 24ISAPS4752R1ZW")
    .moveDown();

  doc.fillColor("#80602f")
    .text(`INVOICE NO.: ${job.jobId}              Invoice Date: ${dateStr}`)
    .moveDown()
    .text("BILL TO: ").fillColor("#000").text(job.partyName).moveDown();

  const amount = job.quantity * job.rate;
  const cgst = amount * 0.025;
  const sgst = amount * 0.025;
  const grandTotal = amount + cgst + sgst;

  doc.fontSize(13).text("DESCRIPTION", 35).text("FABRIC", 35, doc.y)
    .text("QTY", 280).text(job.quantity.toString(), 280, doc.y)
    .text("UNIT PRICE", 350).text(job.rate.toFixed(2), 350, doc.y)
    .text("TOTAL", 440).text(amount.toFixed(2), 440, doc.y);

  doc.moveDown().fontSize(13)
    .text(`SUBTOTAL        : ${amount.toFixed(2)}`, 384)
    .text(`CGST @ 2.5%  : ${cgst.toFixed(2)}`, 384)
    .text(`SGST @ 2.5%  : ${sgst.toFixed(2)}`, 384)
    .fillColor("#80602f")
    .text(`GRAND TOTAL : ${grandTotal.toFixed(2)}`, 384);

  doc.fillColor("#000").moveDown(5).text("Seal & Signature", 384);
  doc.end();
  return filePath;
};

// 📦 Expense Routes
exports.addExpense = async (req, res) => {
  const { type, description, amount } = req.body;
  if (!type || !amount) return res.status(400).json({ error: "Type & amount required" });

  const gst = amount * 0.05;
  const exp = new Expense({ type, description, amount, gst });
  await exp.save();
  res.json({ message: "Expense recorded", exp });
};

exports.getExpenses = async (req, res) => {
  const data = await Expense.find().sort({ date: -1 });
  res.json(data);
};

exports.searchExpenses = async (req, res) => {
  const { partyName, date } = req.query;
  const query = {};

  if (partyName) query.description = { $regex: partyName, $options: "i" };
  if (date) {
    const start = new Date(date);
    const end = new Date(date); end.setDate(end.getDate() + 1);
    query.date = { $gte: start, $lt: end };
  }

  const data = await Expense.find(query).sort({ date: -1 });
  res.json(data);
};

// 🔍 Search Jobs
exports.searchJobs = async (req, res) => {
  const { partyName } = req.query;
  const jobs = await FabricJob.find({ partyName: { $regex: partyName, $options: "i" } });
  res.json(jobs);
};

// 📊 Dashboard Stats
exports.getStats = async (req, res) => {
  const totalJobs = await FabricJob.countDocuments();
  const totalExpenses = await Expense.aggregate([{ $group: { _id: null, total: { $sum: "$amount" } } }]);
  const delivered = await FabricJob.countDocuments({ stage: "delivered" });
  const pending = await FabricJob.countDocuments({ stage: { $ne: "delivered" } });

  res.json({
    totalJobs,
    totalExpenses: totalExpenses[0]?.total || 0,
    delivered,
    pending,
  });
};

exports.getChartData = async (req, res) => {
  const stageCounts = await FabricJob.aggregate([{ $group: { _id: "$stage", count: { $sum: 1 } } }]);
  const monthWiseExpenses = await Expense.aggregate([{ $group: { _id: { $month: "$date" }, total: { $sum: "$amount" } } }]);
  res.json({ stageCounts, monthWiseExpenses });
};

// ⚙️ Rates Config
exports.setRates = async (req, res) => {
  const { coatingRate, washingRate } = req.body;
  if (coatingRate == null || washingRate == null) return res.status(400).json({ error: "Rates required" });

  let config = await RateConfig.findOne();
  if (!config) config = new RateConfig({ coatingRate, washingRate });
  else {
    config.coatingRate = coatingRate;
    config.washingRate = washingRate;
  }

  await config.save();
  res.json({ message: "Rates updated", config });
};

exports.getRates = async (req, res) => {
  const config = await RateConfig.findOne();
  if (!config) return res.status(404).json({ error: "Rates not set" });
  res.json(config);
};



exports.getJobSummaryWithExpenses = async (req, res) => {
    const job = await FabricJob.findOne({
        jobId: req.params.jobId
    });
    if (!job) return res.status(404).json({
        error: "Job not found"
    });
    const expenses = await Expense.find({
        description: {
            $regex: job.jobId
        }
    });
    const coating = expenses.filter(e => e.type === "coated").reduce((sum, e) => sum + e.amount, 0);
    const washing = expenses.filter(e => e.type === "washed").reduce((sum, e) => sum + e.amount, 0);
    res.json({
        partyName: job.partyName,
        fabricType: job.fabricType,
        stage: job.stage,
        coatingBill: coating,
        washingBill: washing
    });
}; 
