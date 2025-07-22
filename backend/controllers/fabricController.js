const FabricJob = require("../models/Fabricjob");
const Expense = require("../models/Expense");
const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");
const RateConfig = require('../models/rateConfig');

const mime = require("mime-types");
const twilio = require("twilio");

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const axios = require("axios"); // ✅ Make sure axios is required


// POST /api/fabric/send-bill
exports.sendBillViaWhatsApp = async (req, res) => {
  const { number, fileUrl, partyName, jobId } = req.body;

  if (!number || !fileUrl || !partyName || !jobId) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    await sendWhatsAppPDF(number, fileUrl, partyName, jobId);
    res.json({ message: "PDF sent via WhatsApp" });
  } catch (err) {
    console.error("❌ Error sending WhatsApp PDF:", err);
    res.status(500).json({ error: "Failed to send PDF" });
  }
};



const sendWhatsAppPDF = async (number, fileUrl, partyName, jobId) => {
  try {
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER, // e.g., 'whatsapp:+14155238886'
      to: `whatsapp:+91${number}`,
      body: `Hello ${partyName}, here is your bill for job ${jobId}.`,
      mediaUrl: [fileUrl], // ✅ Use public PDF URL directly
    });

    console.log("✅ WhatsApp PDF sent to", number);
  } catch (err) {
    console.error("❌ Failed to send WhatsApp PDF:", err.message);
    throw err;
  }
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

// 📈 Chart Data: Stage-wise Job Distribution
exports.getChartData = async (req, res) => {
  const stageCounts = await FabricJob.aggregate([
    { $group: { _id: "$stage", count: { $sum: 1 } } },
  ]);
  const monthWiseExpenses = await Expense.aggregate([
    {
      $group: {
        _id: { $month: "$date" },
        total: { $sum: "$amount" },
      },
    },
  ]);
  res.json({ stageCounts, monthWiseExpenses });
};





exports.createJob = async (req, res) => {
  const { partyName, fabricType, quantity, rate, mobileNumber } = req.body;

  // Validate required fields
  if (!partyName || !fabricType || !quantity || !rate || !mobileNumber) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const jobId = "FAB" + Date.now(); // Unique Job ID

    const job = new FabricJob({
      jobId,
      partyName,
      fabricType,
      quantity,
      rate,
      mobileNumber,
      deliveryDate: null // will be set when job is marked delivered
    });

    await job.save();

    res.json({
      message: "✅ Job created successfully",
      job
    });
  } catch (err) {
    console.error("❌ Error creating job:", err);
    res.status(500).json({ error: "Server error while creating job" });
  }
};



exports.scanJob = async (req, res) => {
    console.log("Received jobId:", req.body.jobId);
    const job = await FabricJob.findOne({
        jobId: req.body.jobId.trim()
    });
    if (!job) {
        console.log("❌ No job found for:", req.body.jobId);
        return res.status(404).json({
            error: "Job not found"
        });
    }
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
    mobileNumber: job.mobileNumber // ✅ Add this
});

};

exports.updateStage = async (req, res) => {
  const jobId = req.body.jobId.trim();
  const stage = req.body.stage;
  const job = await FabricJob.findOne({ jobId });

  if (!job) return res.status(404).json({ error: "Job not found" });

  job.stage = stage;
  await job.save();

  res.json({ message: `✅ Stage updated to ${stage}` }); // Respond immediately

  // 👉 Async logic starts after response
  if (stage === "coated" || stage === "washed") {
    const config = await RateConfig.findOne();
    if (config) {
      const rate = stage === "coated" ? config.coatingRate : config.washingRate;
      const amount = job.quantity * rate;
      const gst = amount * 0.05;
      const expense = new Expense({
        type: stage,
        description: `${stage} for ${job.jobId}`,
        amount,
        gst
      });
      await expense.save();
    }
  }

  if (stage === "delivered") {
    try {
      const filePath = await exports.generatePDFBill(job);
      const billUrl = `http://localhost:5000/api/fabric/bill/${path.basename(filePath)}`;

      const mobileNumber = job.mobileNumber.replace(/^(\+91|0)/, '');
      await sendWhatsAppPDF(mobileNumber, billUrl, job.partyName, job.jobId);
      console.log("✅ Bill sent via WhatsApp");
    } catch (err) {
      console.error("❌ Failed to send WhatsApp or generate bill:", err.message);
    }
  }
};


exports.setRates = async (req, res) => {
    const {
        coatingRate,
        washingRate
    } = req.body;
    if (coatingRate == null || washingRate == null) {
        return res.status(400).json({
            error: "Both rates required"
        });
    }
    let config = await RateConfig.findOne();
    if (!config) {
        config = new RateConfig({
            coatingRate,
            washingRate
        });
    } else {
        config.coatingRate = coatingRate;
        config.washingRate = washingRate;
    }
    await config.save();
    res.json({
        message: "Rates updated",
        config
    });
};
exports.getRates = async (req, res) => {
    const config = await RateConfig.findOne();
    if (!config) return res.status(404).json({
        error: "Rates not set"
    });
    res.json(config);
};




exports.getBillByJobId = (req, res) => {
    const jobId = req.params.jobId;
    const dir = path.join(__dirname, '../bills');
    if (!fs.existsSync(dir)) {
        return res.status(404).json({
            error: "Bill directory not found"
        });
    } // Look for a file that includes the jobId in its name   
    const files = fs.readdirSync(dir);
    const file = files.find(f => f.includes(jobId));
    if (!file) {
        return res.status(404).json({
            error: "Bill file not found for this job"
        });
    }
    const filePath = path.join(dir, file);
   res.setHeader('Content-Type', 'application/pdf');
res.setHeader('Content-Disposition', `inline; filename="${file}"`);
res.sendFile(filePath, (err) => {
  if (err) {
    console.error("Error sending bill file:", err);
    res.status(500).json({
      error: "Error sending bill file"
    });
  }
});

};

exports.generatePDFBill = async (job) => {
    const dir = path.join(__dirname, '../bills');
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir);
    const cleanParty = job.partyName.replace(/\s+/g, '_');
    const now = new Date();
    const dateStr = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
    const filename = `${cleanParty}_${job.jobId}_${dateStr}.pdf`;
    const filePath = path.join(dir, filename);
    const doc = new PDFDocument({
        margin: 40
    });
    doc.pipe(fs.createWriteStream(filePath));


    // Outer border   
    doc.rect(27, 20, 555, 750).strokeColor('#80602f').lineWidth(1.5).stroke();

    // Logo centered
    try {
        const pageWidth = doc.page.width;
        const logoWidth = 100;
        const centerX = (pageWidth - logoWidth) / 2;
        doc.image(path.join(__dirname, '../Utilities/logo.png'), centerX, 30, {
            width: logoWidth
        });
    } catch (err) {
        console.warn('⚠️ Logo not found or error rendering logo');
    }
    doc.fontSize(20).fillColor('#80602f').text('Harsh Enterprise', 35, 120);
    doc.moveDown(0.5);
    doc.fontSize(13).fillColor('#000')
        .text('ADDRESS', 35, doc.y, {
            continued: true
        })
        .fillColor('#000').text(" : No.33/1, 1st Floor, JBJ Compound, Near Dharmesh Dyeing,")
        .text('Behind Subjail, Khatodra, Surat-395002', 108)
        .text('EMAIL', 35, doc.y, {
            continued: true
        })
        .fillColor('#000').text(" : HarshEnterprise@gmail.com", 57)
        .text('CONTACT : +91-8238271922 ', 35)
        .text('CONTACT : +91-9979526411 ', 35)
        .text('GSTIN', 35, doc.y, {
            continued: true
        })
        .fillColor('#000').text(" : 24ISAPS4752R1ZW", 56);

    doc.moveDown(1.5);

    // INVOICE NO + DATE   
    doc.fontSize(13).fillColor('#80602f')
        .text('INVOICE NO.: ', 35, doc.y, {
            continued: true
        })
        .fillColor('#000').text(job.jobId, {
            continued: true
        })
        .fillColor('#80602f').text('                                        Invoice Date: ', {
            continued: true
        })
        .fillColor('#000')
        .text(dateStr);

    doc.moveDown(3);

    // BILL TO
    doc.fontSize(13).fillColor('#80602f')
        .text('BILL TO: ', 35, doc.y, {
            continued: true
        });

    doc.fillColor('#000').text(job.partyName);
    doc.moveDown(2);

    // Table headers 
    const colDescX = 35;
    const colQtyX = 280;
    const colUnitX = 350;
    const colTotalX = 440;
    const headerY = doc.y + 5;

    // Use a consistent y for all headers  
    doc.fontSize(13).fillColor('#80602f')
        .text('DESCRIPTION', colDescX, headerY, {
            width: 200
        })
        .text('QTY', colQtyX, headerY, {
            width: 50,
            align: 'right'
        })
        .text('UNIT PRICE', colUnitX, headerY, {
            width: 80,
            align: 'right'
        })
        .text('TOTAL', colTotalX, headerY, {
            width: 80,
            align: 'right'
        });

    doc.moveTo(colDescX, doc.y + 2).lineTo(550, doc.y + 2).stroke();

    // Amounts
    const amount = job.quantity * job.rate;
    const cgst = amount * 0.025;
    const sgst = amount * 0.025;
    const grandTotal = amount + cgst + sgst;

    // Table row — align same as header 
    const rowY = doc.y + 5;
    doc.fillColor('#000')
        .text(job.fabricType, colDescX, rowY, {
            width: 200
        })
        .text(job.quantity.toString(), colQtyX, rowY, {
            width: 50,
            align: 'right'
        })
        .text(job.rate.toFixed(2), colUnitX, rowY, {
            width: 60,
            align: 'right'
        })
        .text(amount.toFixed(2), colTotalX, rowY, {
            width: 80,
            align: 'right'
        });

    doc.moveTo(colDescX, rowY + 15).lineTo(550, rowY + 15).stroke();

    // Summary   

    doc.moveDown(2);
    const summaryX = 385;
    doc.fontSize(13).fillColor('#000')
        .text(`SUBTOTAL        : ${amount.toFixed(2)}`, 384, doc.y)
        .text(`CGST @ 2.5%  : ${cgst.toFixed(2)}`, summaryX, doc.y)
        .text(`SGST @ 2.5%  : ${sgst.toFixed(2)}`, summaryX, doc.y)
        .fillColor('#80602f')
        .text(`GRAND TOTAL : ${grandTotal.toFixed(2)}`, summaryX, doc.y);

    doc.fillColor('#000');

    doc.moveDown(5);

    // Seal & Signature   
    const sigY = doc.y;
    doc.text('Seal & Signature', summaryX, sigY);
    doc.moveTo(summaryX, sigY + 15).lineTo(550, sigY + 15).stroke();
    doc.end();
    return filePath;
};

exports.getBillNameByJobId = async (req, res) => {
  const jobId = req.params.jobId;

  try {
    const dir = path.join(__dirname, '../bills');
    if (!fs.existsSync(dir)) {
      return res.status(404).json({ error: "Bill directory not found" });
    }

    const files = fs.readdirSync(dir);
    const matchingFile = files.find(file => file.includes(jobId) && file.endsWith('.pdf'));

     
    if (!matchingFile) {
      return res.status(404).json({ error: "Bill PDF not found for this jobId" });
    }

    res.json({ billName: matchingFile });
  } catch (err) {
    console.error("Error in getBillNameByJobId:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};

// 📄 Preview-friendly version of getBill
exports.getBill = (req, res) => {
  const filePath = path.join(__dirname, '../bills', req.params.fileName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Bill not found" });
  }
res.setHeader("Content-Disposition", "inline");
res.setHeader("Content-Type", "application/pdf");


  res.sendFile(filePath);
};

exports.addExpense = async (req, res) => {
    const {
        type,
        description,
        amount
    } = req.body;
    if (!type || !amount)
        return res.status(400).json({
            error: "Type and amount required"
        });

    const gst = amount * 0.05;
    const exp = new Expense({
        type,
        description,
        amount,
        gst
    });
    await exp.save();
    res.json({
        message: "Expense recorded",
        exp
    });

};

exports.getExpenses = async (req, res) => {
    const data = await Expense.find().sort({
        date: -1
    });
    res.json(data);
};

exports.searchExpenses = async (req, res) => {
    const {
        partyName,
        date
    } = req.query;
    const query = {};
    if (partyName)
        query.description = {
            $regex: partyName,
            $options: 'i'
        };

    if (date) {
        const start = new Date(date);
        const end = new Date(date);
        end.setDate(end.getDate() + 1);
        query.date = {
            $gte: start,
            $lt: end
        };
    }

    const data = await Expense.find(query).sort({
        date: -1
    });
    res.json(data);
};

exports.searchJobs = async (req, res) => {
    const {
        partyName
    } = req.query;
    const jobs = await FabricJob.find({
        partyName: {
            $regex: partyName,
            $options: 'i'
        }
    });
    res.json(jobs);
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
