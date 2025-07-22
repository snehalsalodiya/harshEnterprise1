const FabricJob = require("../models/Fabricjob");
const Expense = require("../models/Expense");
const RateConfig = require('../models/rateConfig');
const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");
const twilio = require("twilio");

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const twilioPhoneNumber = "whatsapp:+14155238886"; // Ensure you configure correctly

// 🔔 Helper to send WhatsApp with PDF
const sendWhatsAppPDF = async (number, fileUrl, partyName, jobId) => {
  try {
    await client.messages.create({
      from: twilioPhoneNumber,
      to: `whatsapp:+91${number}`,
      body: `Hello ${partyName}, here is your bill for job ${jobId}.`,
      mediaUrl: [fileUrl],
    });
    console.log("✅ WhatsApp PDF sent to", number);
  } catch (err) {
    console.error("❌ Failed to send WhatsApp PDF:", err.message);
    throw err;
  }
};

// 📦 Create a job
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
  } catch (err) {
    console.error("❌ Error creating job:", err);
    res.status(500).json({ error: "Server error while creating job" });
  }
};

// 📍 Scan Job
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
  } catch (err) {
    console.error("❌ Scan error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};

// 🔁 Update Job Stage
exports.updateStage = async (req, res) => {
  const jobId = req.body.jobId.trim();
  const stage = req.body.stage;

  try {
    const job = await FabricJob.findOne({ jobId });
    if (!job) return res.status(404).json({ error: "Job not found" });

    job.stage = stage;
    await job.save();
    res.json({ message: `✅ Stage updated to ${stage}` });

    // Record Expense
    if (stage === "coated" || stage === "washed") {
      const config = await RateConfig.findOne();
      if (config) {
        const rate = stage === "coated" ? config.coatingRate : config.washingRate;
        const amount = job.quantity * rate;
        const gst = amount * 0.05;
        await new Expense({ type: stage, description: `${stage} for ${job.jobId}`, amount, gst }).save();
      }
    }

    // On Delivery, generate bill & send
    if (stage === "delivered") {
      try {
        const filePath = await exports.generatePDFBill(job);
        const billUrl = `https://harshenterprise123.onrender.com/api/fabric/bill/${path.basename(filePath)}`;
        await sendWhatsAppPDF(job.mobileNumber, billUrl, job.partyName, job.jobId);
        console.log("✅ Bill sent via WhatsApp");
      } catch (err) {
        console.error("❌ Failed to generate/send bill:", err.message);
      }
    }
  } catch (err) {
    console.error("❌ Stage update error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};

// 🧾 Generate PDF Bill
exports.generatePDFBill = async (job) => {
  const dir = path.join(__dirname, '../bills');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);

  const cleanParty = job.partyName.replace(/\s+/g, '_');
  const now = new Date();
  const dateStr = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
  const filename = `${cleanParty}_${job.jobId}_${dateStr}.pdf`;
  const filePath = path.join(dir, filename);
  const doc = new PDFDocument({ margin: 40 });

  doc.pipe(fs.createWriteStream(filePath));

  doc.rect(27, 20, 555, 750).strokeColor('#80602f').lineWidth(1.5).stroke();

  try {
    const pageWidth = doc.page.width;
    const centerX = (pageWidth - 100) / 2;
    doc.image(path.join(__dirname, '../Utilities/logo.png'), centerX, 30, { width: 100 });
  } catch { console.warn("⚠️ Logo not found"); }

  doc.fontSize(20).fillColor('#80602f').text('Harsh Enterprise', 35, 120);

  doc.fontSize(13).fillColor('#000')
    .text('ADDRESS : No.33/1, 1st Floor, JBJ Compound, Near Dharmesh Dyeing,')
    .text('Behind Subjail, Khatodra, Surat-395002')
    .text('EMAIL : HarshEnterprise@gmail.com')
    .text('CONTACT : +91-8238271922')
    .text('CONTACT : +91-9979526411')
    .text('GSTIN : 24ISAPS4752R1ZW');

  doc.moveDown(1.5);
  doc.fontSize(13).fillColor('#80602f')
    .text(`INVOICE NO.: ${job.jobId}              Invoice Date: ${dateStr}`);

  doc.moveDown(2).fontSize(13).fillColor('#80602f').text('BILL TO: ').fillColor('#000').text(job.partyName);
  doc.moveDown(1);

  const colDescX = 35, colQtyX = 280, colUnitX = 350, colTotalX = 440;
  const headerY = doc.y + 5;

  doc.fontSize(13).fillColor('#80602f')
    .text('DESCRIPTION', colDescX, headerY, { width: 200 })
    .text('QTY', colQtyX, headerY, { width: 50, align: 'right' })
    .text('UNIT PRICE', colUnitX, headerY, { width: 80, align: 'right' })
    .text('TOTAL', colTotalX, headerY, { width: 80, align: 'right' });

  doc.moveTo(colDescX, doc.y + 2).lineTo(550, doc.y + 2).stroke();

  const amount = job.quantity * job.rate;
  const cgst = amount * 0.025;
  const sgst = amount * 0.025;
  const grandTotal = amount + cgst + sgst;

  const rowY = doc.y + 5;
  doc.fillColor('#000')
    .text(job.fabricType, colDescX, rowY)
    .text(job.quantity.toString(), colQtyX, rowY, { align: 'right' })
    .text(job.rate.toFixed(2), colUnitX, rowY, { align: 'right' })
    .text(amount.toFixed(2), colTotalX, rowY, { align: 'right' });

  doc.moveTo(colDescX, rowY + 15).lineTo(550, rowY + 15).stroke();

  doc.moveDown(2).fontSize(13)
    .text(`SUBTOTAL        : ${amount.toFixed(2)}`, 384)
    .text(`CGST @ 2.5%  : ${cgst.toFixed(2)}`, 384)
    .text(`SGST @ 2.5%  : ${sgst.toFixed(2)}`, 384)
    .fillColor('#80602f')
    .text(`GRAND TOTAL : ${grandTotal.toFixed(2)}`, 384);

  doc.fillColor('#000').moveDown(5).text('Seal & Signature', 384);
  doc.moveTo(384, doc.y + 15).lineTo(550, doc.y + 15).stroke();

  doc.end();
  return filePath;
};

// 📲 Send PDF via WhatsApp manually
exports.sendBillViaWhatsApp = async (req, res) => {
  const { jobId, number, partyName } = req.body;

  if (!jobId || !number || !partyName) {
    return res.status(400).json({ error: "Missing jobId, number or partyName" });
  }

  const dir = path.join(__dirname, "../bills");
  if (!fs.existsSync(dir)) return res.status(404).json({ error: "Bill directory not found" });

  const file = fs.readdirSync(dir).find(f => f.includes(jobId) && f.endsWith(".pdf"));
  if (!file) return res.status(404).json({ error: "Bill PDF not found for this job ID" });

  const fileUrl = `https://harshenterprise123.onrender.com/api/fabric/bill/${file}`;

  try {
    const message = await client.messages.create({
      from: twilioPhoneNumber,
      to: `whatsapp:+91${number}`,
      body: `Hello ${partyName}, here is your bill for job ${jobId}.`,
      mediaUrl: [fileUrl],
    });

    res.json({ success: true, sid: message.sid });
  } catch (err) {
    console.error("❌ WhatsApp send error:", err.message);
    res.status(500).json({ error: "Failed to send WhatsApp message", details: err.message });
  }
};

// 💹 Stats and Analytics
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

// 💰 Expenses
exports.addExpense = async (req, res) => {
  const { type, description, amount } = req.body;
  if (!type || !amount) return res.status(400).json({ error: "Type and amount required" });

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

  if (partyName) query.description = { $regex: partyName, $options: 'i' };
  if (date) {
    const start = new Date(date);
    const end = new Date(date);
    end.setDate(end.getDate() + 1);
    query.date = { $gte: start, $lt: end };
  }

  const data = await Expense.find(query).sort({ date: -1 });
  res.json(data);
};

// 🔍 Job Search
exports.searchJobs = async (req, res) => {
  const { partyName } = req.query;
  const jobs = await FabricJob.find({ partyName: { $regex: partyName, $options: 'i' } });
  res.json(jobs);
};

// 📊 Job Summary
exports.getJobSummaryWithExpenses = async (req, res) => {
  const job = await FabricJob.findOne({ jobId: req.params.jobId });
  if (!job) return res.status(404).json({ error: "Job not found" });

  const expenses = await Expense.find({ description: { $regex: job.jobId } });
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

// 📜 Bill File Utilities
exports.getBillNameByJobId = async (req, res) => {
  const jobId = req.params.jobId;
  const dir = path.join(__dirname, '../bills');

  if (!fs.existsSync(dir)) return res.status(404).json({ error: "Bill directory not found" });
  const file = fs.readdirSync(dir).find(f => f.includes(jobId) && f.endsWith('.pdf'));

  if (!file) return res.status(404).json({ error: "Bill PDF not found for this jobId" });
  res.json({ billName: file });
};

exports.getBill = (req, res) => {
  const filePath = path.join(__dirname, '../bills', req.params.fileName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Bill not found" });

  res.setHeader("Content-Disposition", "inline");
  res.setHeader("Content-Type", "application/pdf");
  res.sendFile(filePath);
};

exports.getBillLink = (req, res) => {
  const jobId = req.params.jobId;
  const dir = path.join(__dirname, "../bills");

  if (!fs.existsSync(dir)) return res.status(404).json({ error: "Bill directory not found" });
  const file = fs.readdirSync(dir).find((f) => f.includes(jobId));
  if (!file) return res.status(404).json({ error: "Bill not found for this job ID" });

  const fullUrl = `${process.env.BASE_URL}/bills/${file}`;
  res.json({ url: fullUrl });
};

// ⚙️ Rate config
exports.setRates = async (req, res) => {
  const { coatingRate, washingRate } = req.body;
  if (coatingRate == null || washingRate == null) return res.status(400).json({ error: "Both rates required" });

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
